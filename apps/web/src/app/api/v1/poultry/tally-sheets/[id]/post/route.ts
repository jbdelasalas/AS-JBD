export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  const [rec] = await query<Record<string, unknown>>(
    `SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status !== 'saved') return err(`Cannot post from status: ${rec.status}`, 400);
  const lines = await query<Record<string, unknown>>(`SELECT * FROM tally_sheet_lines WHERE tally_sheet_id = $1`, [params.id]);
  if (!lines.length) return err('No lines to post', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Update grow cycle harvested heads if linked
    let liveItemId: string | null = null;
    let liveAvgCostPerKg = 0;
    if (rec.grow_cycle_id) {
      const harvestedHeads = Number(rec.net_heads ?? 0);
      await client.query(
        `UPDATE grow_cycles SET heads_harvested = heads_harvested + $1, heads_available = heads_available - $1,
          status = CASE WHEN heads_available - $1 <= 0 THEN 'completed' ELSE 'harvesting' END
         WHERE id = $2`,
        [harvestedHeads, rec.grow_cycle_id],
      );

      // Compute live chicken avg cost: (DOC cost + consumption) ÷ total harvested kgs
      const [gc] = await client.query(
        `SELECT g.chick_price_per_head, g.heads_in, g.live_item_id,
                COALESCE(SUM(c.total_cost), 0) AS total_consumption_cost
           FROM grow_cycles g
           LEFT JOIN grow_item_consumption c ON c.grow_cycle_id = g.id
          WHERE g.id = $1
          GROUP BY g.id, g.chick_price_per_head, g.heads_in, g.live_item_id`,
        [rec.grow_cycle_id],
      ).then(r => r.rows);

      if (gc) {
        liveItemId = (gc.live_item_id as string | null) ?? null;
        const totalGrowCost = Number(gc.chick_price_per_head ?? 0) * Number(gc.heads_in ?? 0)
                            + Number(gc.total_consumption_cost ?? 0);

        // Sum kgs already posted + current batch (by live item if set, else all lines)
        const prevKgsResult = liveItemId
          ? await client.query(
              `SELECT COALESCE(SUM(tsl.net_kgs), 0) AS prev_kgs
                 FROM tally_sheet_lines tsl
                 JOIN tally_sheets ts ON ts.id = tsl.tally_sheet_id
                WHERE ts.grow_cycle_id = $1 AND ts.status = 'posted' AND tsl.item_id = $2`,
              [rec.grow_cycle_id, liveItemId])
          : await client.query(
              `SELECT COALESCE(SUM(tsl.net_kgs), 0) AS prev_kgs
                 FROM tally_sheet_lines tsl
                 JOIN tally_sheets ts ON ts.id = tsl.tally_sheet_id
                WHERE ts.grow_cycle_id = $1 AND ts.status = 'posted'`,
              [rec.grow_cycle_id]);
        const prevKgs = Number(prevKgsResult.rows[0]?.prev_kgs ?? 0);
        const currentKgs = lines
          .filter(l => liveItemId === null || l.item_id === liveItemId)
          .reduce((s, l) => s + Number(l.net_kgs ?? 0), 0);
        const totalHarvestedKgs = prevKgs + currentKgs;

        if (totalHarvestedKgs > 0 && totalGrowCost > 0) {
          liveAvgCostPerKg = totalGrowCost / totalHarvestedKgs;
        }
      }
    }

    // Resolve warehouse from destination_id or branch_id so stock_balances stays in sync
    const tsBranchId = (rec.destination_id ?? rec.branch_id) as string | null;
    const tsWhRow = tsBranchId
      ? await client.query(`SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1`, [tsBranchId])
      : { rows: [] };
    const tsWarehouseId: string | null = tsWhRow.rows[0]?.id ?? null;

    // Write inventory for each line
    for (const l of lines) {
      const netKgs = Number(l.net_kgs ?? 0);
      const heads = Number(l.heads ?? 0);
      if (netKgs <= 0 && heads <= 0) continue;

      const balRow = await client.query(
        `SELECT qty_heads, qty_kgs, avg_cost FROM poultry_inventory_balance
          WHERE company_id=$1 AND warehouse_id IS NOT DISTINCT FROM $2 AND item_id=$3 FOR UPDATE`,
        [rec.company_id, rec.warehouse_id, l.item_id],
      );
      const bal = balRow.rows[0] ?? { qty_heads: 0, qty_kgs: 0, avg_cost: 0 };
      const newHeads = Number(bal.qty_heads) + heads;
      const newKgs = Number(bal.qty_kgs) + netKgs;

      await client.query(
        `INSERT INTO poultry_inventory_ledger (company_id, warehouse_id, item_id, movement_type, source_type, source_id, source_doc_no, transaction_date, heads_in, kgs_in, balance_heads, balance_kgs)
         SELECT $1,$2,$3,'in','tally_sheet',$4,doc_no,$5,$6,$7,$8,$9 FROM tally_sheets WHERE id=$4`,
        [rec.company_id, rec.warehouse_id, l.item_id, params.id, rec.transfer_date, heads, netKgs, newHeads, newKgs],
      );
      const useGrowCostForBal = liveItemId === null || l.item_id === liveItemId;
      const avgCost = (useGrowCostForBal && liveAvgCostPerKg > 0) ? liveAvgCostPerKg : Number(bal.avg_cost ?? 0);
      await client.query(
        `INSERT INTO poultry_inventory_balance (company_id, warehouse_id, item_id, qty_heads, qty_kgs, avg_cost, last_updated)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (company_id, warehouse_id, item_id) DO UPDATE SET qty_heads=$4, qty_kgs=$5, avg_cost=$6, last_updated=now()`,
        [rec.company_id, rec.warehouse_id, l.item_id, newHeads, newKgs, avgCost],
      );

      // Mirror to stock_balances so standard stock-on-hand stays in sync
      if (tsWarehouseId && netKgs > 0) {
        await client.query(
          `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
           VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (item_id, warehouse_id) DO UPDATE SET
             qty_on_hand = GREATEST(0, stock_balances.qty_on_hand + $3),
             avg_cost = CASE WHEN stock_balances.qty_on_hand + $3 > 0
                        THEN (stock_balances.qty_on_hand * stock_balances.avg_cost + $3 * $4) / (stock_balances.qty_on_hand + $3)
                        ELSE $4 END,
             last_movement_at = now()`,
          [l.item_id, tsWarehouseId, netKgs, avgCost],
        );
        await client.query(
          `INSERT INTO stock_movements
             (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
              reference_type, reference_id, reference_no, created_by)
           VALUES ($1,$2,$3,'harvest',$4,$5,$6,'tally_sheet',$7,$8,$9)`,
          [rec.company_id, l.item_id, tsWarehouseId,
           netKgs, avgCost, netKgs * avgCost,
           params.id, rec.doc_no, auth.userId],
        );
      }
    }

    // --- GL: DR Inventory per item, CR Inventory Adjustment (production recognition) ---
    let tsJeId: string | null = null;
    const _rd = rec.transfer_date;
    const jeDate = (_rd instanceof Date ? _rd.toISOString().split('T')[0] : _rd ? String(_rd).substring(0, 10) : null) ?? new Date().toISOString().split('T')[0];
    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [rec.company_id, jeDate],
    );
    const period = periodRows.rows[0];
    if (period && period.status !== 'closed') {
      const [defInvRows, adjAcctRows] = await Promise.all([
        client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET'
             AND (code = '1200' OR name ILIKE '%inventory%') AND is_active = true ORDER BY code ASC LIMIT 1`,
          [rec.company_id],
        ),
        client.query(
          `SELECT id FROM accounts WHERE company_id = $1
             AND (code = '5020' OR name ILIKE '%inventory adjustment%') AND is_active = true ORDER BY code ASC LIMIT 1`,
          [rec.company_id],
        ),
      ]);
      const defaultInvId: string | null = defInvRows.rows[0]?.id ?? null;
      const adjAcctId: string | null = adjAcctRows.rows[0]?.id ?? null;

      if (defaultInvId && adjAcctId) {
        const itemAcctRows = await client.query(
          `SELECT id, inventory_account_id, name FROM items WHERE id = ANY($1::uuid[])`,
          [lines.map(l => l.item_id)],
        );
        const itemMap = new Map(
          (itemAcctRows.rows as Array<Record<string, unknown>>).map(i => [
            String(i.id),
            { name: String(i.name), inventory_account_id: (i.inventory_account_id as string | null) ?? null },
          ]),
        );

        const jeLines: Array<{ account_id: string; description: string; debit: number; credit: number }> = [];
        let totalAmount = 0;
        for (const l of lines) {
          const netKgs = Number(l.net_kgs ?? 0);
          if (netKgs <= 0) continue;
          const useGrowCost = liveItemId === null || l.item_id === liveItemId;
          const avgCost = useGrowCost ? liveAvgCostPerKg : Number((l as Record<string,unknown>).unit_cost ?? 0);
          const amount = parseFloat((netKgs * avgCost).toFixed(2));
          if (amount <= 0) continue;
          const info = itemMap.get(String(l.item_id));
          const itemInvId = info?.inventory_account_id ?? defaultInvId;
          jeLines.push({ account_id: itemInvId, description: `Harvest — ${info?.name ?? l.item_id} (${rec.doc_no})`, debit: amount, credit: 0 });
          totalAmount = parseFloat((totalAmount + amount).toFixed(2));
        }

        if (jeLines.length > 0 && totalAmount > 0) {
          jeLines.push({ account_id: adjAcctId, description: `Harvest recognition (${rec.doc_no})`, debit: 0, credit: totalAmount });
          const seriesRows = await client.query(
            `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
              WHERE company_id = $1 AND doc_type = 'journal_voucher' AND is_active = true RETURNING prefix, current_number`,
            [rec.company_id],
          );
          if (seriesRows.rows[0]) {
            const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;
            const jeInsert = await client.query(
              `INSERT INTO journal_entries (company_id, entry_no, entry_date, fiscal_period_id,
                 reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
               VALUES ($1,$2,$3::date,$4,$5,$6,'inventory','tally_sheet',$7,'posted',$8) RETURNING id`,
              [rec.company_id, jeNo, jeDate, period.id,
               rec.doc_no, `Tally Sheet ${rec.doc_no}`, params.id, auth.userId],
            );
            const jeId = jeInsert.rows[0].id;
            tsJeId = jeId;
            for (let i = 0; i < jeLines.length; i++) {
              const jl = jeLines[i];
              await client.query(
                `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
                 VALUES ($1,$2,$3,$4,$5,$6,'PHP',1,$5,$6)`,
                [jeId, i + 1, jl.account_id, jl.description, jl.debit, jl.credit],
              );
            }
            await client.query(
              `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
               SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
               ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET
                 debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
                 credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
              [jeId, period.id],
            );
            await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [jeId, auth.userId]);
          }
        }
      }
    }

    await client.query(`UPDATE tally_sheets SET status='posted', posted_by=$1, posted_at=now(), je_id=$3 WHERE id=$2`, [auth.userId, params.id, tsJeId ?? null]);
    await client.query('COMMIT');
    const [updated] = await query(`SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
    return ok(updated);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
