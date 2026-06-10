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

    // Resolve warehouse for stock_balances sync: try branch first, fall back to tally sheet's warehouse_id
    const tsBranchId = (rec.destination_id ?? rec.branch_id) as string | null;
    const tsWhRow = tsBranchId
      ? await client.query(`SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1`, [tsBranchId])
      : { rows: [] };
    const tsWarehouseId: string | null = (tsWhRow.rows[0]?.id as string | null) ?? (rec.warehouse_id as string | null) ?? null;

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

    // --- GL: DR Inventory-Live, CR Inventory-DOC / Inventory-Feeds / Inventory-Medicines ---
    // Cost per head = (DOC total + feeds + medicines) ÷ (heads_in − mortality)
    // This harvest cost = cost_per_head × net_heads
    let tsJeId: string | null = null;
    const _rd = rec.transfer_date;
    const jeDate = (_rd instanceof Date ? _rd.toISOString().split('T')[0] : _rd ? String(_rd).substring(0, 10) : null) ?? new Date().toISOString().split('T')[0];
    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [rec.company_id, jeDate],
    );
    const period = periodRows.rows[0];

    if (period && period.status !== 'closed' && rec.grow_cycle_id) {
      const gcGlRow = await client.query(
        `SELECT g.chick_price_per_head, g.heads_in, g.total_mortality, b.item_id AS doc_item_id
           FROM grow_cycles g
           JOIN chick_batches b ON b.id = g.batch_id
          WHERE g.id = $1`,
        [rec.grow_cycle_id],
      );
      const gcGl = gcGlRow.rows[0] as Record<string, unknown> | undefined;
      const thisHarvestHeads = Number(rec.net_heads ?? 0);
      const totalAvailableHeads = gcGl ? Number(gcGl.heads_in ?? 0) - Number(gcGl.total_mortality ?? 0) : 0;
      const docCost = gcGl ? Number(gcGl.chick_price_per_head ?? 0) * Number(gcGl.heads_in ?? 0) : 0;

      if (gcGl && thisHarvestHeads > 0 && totalAvailableHeads > 0) {
        // Consumption breakdown by item for proportional CR entries
        const consGlRows = await client.query(
          `SELECT c.item_id, SUM(c.total_cost) AS total_cost, i.inventory_account_id, i.name
             FROM grow_item_consumption c
             JOIN items i ON i.id = c.item_id
            WHERE c.grow_cycle_id = $1
            GROUP BY c.item_id, i.inventory_account_id, i.name`,
          [rec.grow_cycle_id],
        );
        const totalConsCost = (consGlRows.rows as Array<Record<string, unknown>>)
          .reduce((s, c) => s + Number(c.total_cost ?? 0), 0);
        const totalGrowCost = docCost + totalConsCost;

        if (totalGrowCost > 0) {
          const thisHarvestCost = parseFloat((totalGrowCost / totalAvailableHeads * thisHarvestHeads).toFixed(2));

          // DR: tally line items grouped by inventory account, prorated by heads
          const totalLineHeads = lines.reduce((s, l) => s + Number(l.heads ?? 0), 0);
          const lineItemGlRows = await client.query(
            `SELECT id, inventory_account_id FROM items WHERE id = ANY($1::uuid[])`,
            [[...new Set(lines.map(l => String(l.item_id)))]],
          );
          const lineItemGlMap = new Map(
            (lineItemGlRows.rows as Array<Record<string, unknown>>).map(i => [
              String(i.id), (i.inventory_account_id as string | null) ?? null,
            ]),
          );
          const drByAcct = new Map<string, number>();
          for (const l of lines) {
            const heads = Number(l.heads ?? 0);
            if (heads <= 0 || totalLineHeads <= 0) continue;
            const acctId = lineItemGlMap.get(String(l.item_id));
            if (!acctId) continue;
            const amount = parseFloat((thisHarvestCost * (heads / totalLineHeads)).toFixed(2));
            if (amount > 0) drByAcct.set(acctId, (drByAcct.get(acctId) ?? 0) + amount);
          }

          // CR: DOC item account + each consumption item account, prorated by cost share
          const crByAcct = new Map<string, { amount: number; desc: string }>();
          if (docCost > 0 && gcGl.doc_item_id) {
            const docAcctRow = await client.query(
              `SELECT inventory_account_id FROM items WHERE id = $1 LIMIT 1`, [gcGl.doc_item_id]);
            const docAcctId = (docAcctRow.rows[0]?.inventory_account_id as string | null) ?? null;
            if (docAcctId) {
              const share = parseFloat(((docCost / totalGrowCost) * thisHarvestCost).toFixed(2));
              crByAcct.set(docAcctId, { amount: (crByAcct.get(docAcctId)?.amount ?? 0) + share, desc: 'DOC' });
            }
          }
          for (const c of consGlRows.rows as Array<Record<string, unknown>>) {
            const cCost = Number(c.total_cost ?? 0);
            const cAcctId = (c.inventory_account_id as string | null);
            if (cCost <= 0 || !cAcctId) continue;
            const share = parseFloat(((cCost / totalGrowCost) * thisHarvestCost).toFixed(2));
            const existing = crByAcct.get(cAcctId);
            crByAcct.set(cAcctId, { amount: (existing?.amount ?? 0) + share, desc: String(c.name) });
          }

          // Rounding: adjust last CR so total CR = total DR exactly
          const totalDrAmt = [...drByAcct.values()].reduce((s, v) => s + v, 0);
          const totalCrAmt = [...crByAcct.values()].reduce((s, v) => s + v.amount, 0);
          const roundAdj = parseFloat((totalDrAmt - totalCrAmt).toFixed(2));
          if (roundAdj !== 0 && crByAcct.size > 0) {
            const lastKey = [...crByAcct.keys()].at(-1)!;
            const last = crByAcct.get(lastKey)!;
            crByAcct.set(lastKey, { ...last, amount: parseFloat((last.amount + roundAdj).toFixed(2)) });
          }

          if (drByAcct.size > 0 && crByAcct.size > 0) {
            const seriesRows = await client.query(
              `UPDATE document_series SET current_number = GREATEST(current_number, COALESCE((SELECT MAX(NULLIF(regexp_replace(substr(je.entry_no, length(document_series.prefix) + 1), '\\D', '', 'g'), '')::bigint) FROM journal_entries je WHERE je.company_id = document_series.company_id AND je.entry_no LIKE document_series.prefix || '%'), 0)) + 1, updated_at = now()
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
              let lineNo = 1;
              for (const [acctId, amount] of drByAcct) {
                await client.query(
                  `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
                   VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
                  [jeId, lineNo++, acctId, `Harvest — Live Chicken (${rec.doc_no})`, amount],
                );
              }
              for (const [acctId, val] of crByAcct) {
                if (val.amount <= 0) continue;
                await client.query(
                  `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
                   VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
                  [jeId, lineNo++, acctId, `Harvest cost — ${val.desc} (${rec.doc_no})`, val.amount],
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
    }

    await client.query(`UPDATE tally_sheets SET status='posted', posted_by=$1, posted_at=now(), je_id=$3 WHERE id=$2`, [auth.userId, params.id, tsJeId ?? null]);
    await client.query('COMMIT');
    const [updated] = await query(`SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
    return ok(updated);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
