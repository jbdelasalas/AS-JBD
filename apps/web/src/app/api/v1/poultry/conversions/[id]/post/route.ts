export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  const [rec] = await query<Record<string, unknown>>(`SELECT * FROM conversions WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status !== 'saved') return err(`Cannot post from status: ${rec.status}`, 400);
  const outputs = await query<Record<string, unknown>>(`SELECT * FROM conversion_outputs WHERE conversion_id = $1`, [params.id]);
  if (!outputs.length) return err('No output lines', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Resolve warehouses from branch_id / target_branch_id for stock_balances sync
    const srcBranchId = rec.branch_id as string | null;
    const tgtBranchId = (rec.target_branch_id ?? rec.branch_id) as string | null;
    const srcWhRow = srcBranchId
      ? await client.query(`SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1`, [srcBranchId])
      : { rows: [] };
    const tgtWhRow = tgtBranchId
      ? await client.query(`SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1`, [tgtBranchId])
      : { rows: [] };
    const srcWarehouseId: string | null = srcWhRow.rows[0]?.id ?? null;
    const tgtWarehouseId: string | null = tgtWhRow.rows[0]?.id ?? null;

    // Deduct source inventory
    const srcBal = await client.query(
      `SELECT qty_kgs, qty_heads, avg_cost FROM poultry_inventory_balance
        WHERE company_id=$1 AND warehouse_id IS NOT DISTINCT FROM $2 AND item_id=$3 FOR UPDATE`,
      [rec.company_id, rec.warehouse_id, rec.source_item_id],
    );
    const src = srcBal.rows[0];
    const srcKgs = Number(rec.source_kgs ?? 0);
    const srcHeads = Number(rec.source_heads ?? 0);
    if (!src || Number(src.qty_kgs) < srcKgs) { await client.query('ROLLBACK'); return err('Insufficient source inventory (kgs)', 400); }
    const newSrcKgs = Number(src.qty_kgs) - srcKgs;
    const newSrcHeads = Number(src.qty_heads) - srcHeads;

    await client.query(
      `INSERT INTO poultry_inventory_ledger (company_id, warehouse_id, item_id, movement_type, source_type, source_id, source_doc_no, transaction_date, heads_out, kgs_out, balance_heads, balance_kgs)
       SELECT $1,$2,$3,'convert_out','conversion',$4,doc_no,$5,$6,$7,$8,$9 FROM conversions WHERE id=$4`,
      [rec.company_id, rec.warehouse_id, rec.source_item_id, params.id, rec.transaction_date, srcHeads, srcKgs, newSrcHeads, newSrcKgs],
    );
    await client.query(
      `INSERT INTO poultry_inventory_balance (company_id, warehouse_id, item_id, qty_heads, qty_kgs, last_updated) VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (company_id, warehouse_id, item_id) DO UPDATE SET qty_heads=$4, qty_kgs=$5, last_updated=now()`,
      [rec.company_id, rec.warehouse_id, rec.source_item_id, newSrcHeads, newSrcKgs],
    );
    // Mirror source deduction to stock_balances + stock_movement
    const srcAvgCost = Number(src.avg_cost ?? 0);
    if (srcWarehouseId) {
      await client.query(
        `UPDATE stock_balances SET
           qty_on_hand = GREATEST(0, qty_on_hand - $1),
           last_movement_at = now()
         WHERE item_id = $2 AND warehouse_id = $3`,
        [srcKgs, rec.source_item_id, srcWarehouseId],
      );
      await client.query(
        `INSERT INTO stock_movements
           (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_no, created_by)
         VALUES ($1,$2,$3,'convert_out',$4,$5,$6,'conversion',$7,$8,$9)`,
        [rec.company_id, rec.source_item_id, srcWarehouseId,
         -srcKgs, srcAvgCost, srcKgs * srcAvgCost,
         params.id, rec.doc_no, auth.userId],
      );
    }

    // Add output inventory
    const outputCostMap: Array<{ item_id: string; unit_cost: number; total_cost: number; inventory_account_id: string | null }> = [];
    for (const o of outputs) {
      const outKgs = Number(o.kgs ?? 0);
      const outHeads = Number(o.heads ?? 0);
      const balRow = await client.query(
        `SELECT qty_heads, qty_kgs, avg_cost FROM poultry_inventory_balance
          WHERE company_id=$1 AND warehouse_id IS NOT DISTINCT FROM $2 AND item_id=$3 FOR UPDATE`,
        [rec.company_id, rec.warehouse_id, o.output_item_id],
      );
      const bal = balRow.rows[0] ?? { qty_heads: 0, qty_kgs: 0, avg_cost: 0 };
      const newKgs = Number(bal.qty_kgs) + outKgs;
      const newHeads = Number(bal.qty_heads) + outHeads;
      await client.query(
        `INSERT INTO poultry_inventory_ledger (company_id, warehouse_id, item_id, movement_type, source_type, source_id, source_doc_no, transaction_date, heads_in, kgs_in, balance_heads, balance_kgs)
         SELECT $1,$2,$3,'convert_in','conversion',$4,doc_no,$5,$6,$7,$8,$9 FROM conversions WHERE id=$4`,
        [rec.company_id, rec.warehouse_id, o.output_item_id, params.id, rec.transaction_date, outHeads, outKgs, newHeads, newKgs],
      );
      await client.query(
        `INSERT INTO poultry_inventory_balance (company_id, warehouse_id, item_id, qty_heads, qty_kgs, last_updated) VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (company_id, warehouse_id, item_id) DO UPDATE SET qty_heads=$4, qty_kgs=$5, last_updated=now()`,
        [rec.company_id, rec.warehouse_id, o.output_item_id, newHeads, newKgs],
      );
      // Mirror output addition to stock_balances + stock_movement
      if (tgtWarehouseId && outKgs > 0) {
        const unitCost = Number(o.unit_cost ?? 0);
        await client.query(
          `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
           VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (item_id, warehouse_id) DO UPDATE SET
             qty_on_hand = GREATEST(0, stock_balances.qty_on_hand + $3),
             avg_cost = CASE WHEN stock_balances.qty_on_hand + $3 > 0
                        THEN (stock_balances.qty_on_hand * stock_balances.avg_cost + $3 * $4) / (stock_balances.qty_on_hand + $3)
                        ELSE $4 END,
             last_movement_at = now()`,
          [o.output_item_id, tgtWarehouseId, outKgs, unitCost],
        );
        await client.query(
          `INSERT INTO stock_movements
             (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
              reference_type, reference_id, reference_no, created_by)
           VALUES ($1,$2,$3,'convert_in',$4,$5,$6,'conversion',$7,$8,$9)`,
          [rec.company_id, o.output_item_id, tgtWarehouseId,
           outKgs, unitCost, outKgs * unitCost,
           params.id, rec.doc_no, auth.userId],
        );
        // Resolve item's inventory account for GL
        const itemAcctRow = await client.query(
          `SELECT inventory_account_id FROM items WHERE id = $1 LIMIT 1`, [o.output_item_id],
        );
        outputCostMap.push({
          item_id: String(o.output_item_id),
          unit_cost: unitCost,
          total_cost: outKgs * unitCost,
          inventory_account_id: (itemAcctRow.rows[0]?.inventory_account_id as string | null) ?? null,
        });
      }
    }

    // --- GL: DR output inventory accounts, CR source inventory account ---
    const _td = rec.transaction_date;
    const jeDate = (_td instanceof Date ? _td.toISOString().split('T')[0] : _td ? String(_td).substring(0, 10) : null) ?? new Date().toISOString().split('T')[0];
    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [rec.company_id, jeDate],
    );
    const period = periodRows.rows[0];
    if (period && period.status !== 'closed' && outputCostMap.length > 0) {
      const defInvRow = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET'
           AND (code = '1200' OR name ILIKE '%inventory%') AND is_active = true ORDER BY code ASC LIMIT 1`,
        [rec.company_id],
      );
      const defaultInvId: string | null = defInvRow.rows[0]?.id ?? null;
      const srcItemAcctRow = await client.query(
        `SELECT inventory_account_id FROM items WHERE id = $1 LIMIT 1`, [rec.source_item_id],
      );
      const srcInvId = (srcItemAcctRow.rows[0]?.inventory_account_id as string | null) ?? defaultInvId;

      if (srcInvId && defaultInvId) {
        const totalOutputCost = outputCostMap.reduce((s, o) => s + o.total_cost, 0);
        const srcTotalCost = parseFloat((srcKgs * srcAvgCost).toFixed(2));
        const effectiveCreditAmount = parseFloat(Math.max(totalOutputCost, srcTotalCost).toFixed(2));

        if (effectiveCreditAmount > 0) {
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
               VALUES ($1,$2,$3::date,$4,$5,$6,'inventory','conversion',$7,'posted',$8) RETURNING id`,
              [rec.company_id, jeNo, jeDate, period.id,
               rec.doc_no, `Conversion ${rec.doc_no}`, params.id, auth.userId],
            );
            const jeId = jeInsert.rows[0].id;
            let lineNo = 1;
            for (const o of outputCostMap) {
              const outInvId = o.inventory_account_id ?? defaultInvId;
              const amount = parseFloat(o.total_cost.toFixed(2));
              if (amount <= 0) continue;
              await client.query(
                `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
                 VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
                [jeId, lineNo++, outInvId, `Conversion output — ${o.item_id} (${rec.doc_no})`, amount],
              );
            }
            await client.query(
              `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
               VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
              [jeId, lineNo, srcInvId, `Conversion source — ${rec.source_item_id} (${rec.doc_no})`, effectiveCreditAmount],
            );
            await client.query(
              `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
               SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
               ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET
                 debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
                 credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
              [jeId, period.id],
            );
            await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [jeId, auth.userId]);
            await client.query(`UPDATE conversions SET je_id = $2 WHERE id = $1`, [params.id, jeId]);
          }
        }
      }
    }

    await client.query(`UPDATE conversions SET status='posted', posted_by=$1, posted_at=now() WHERE id=$2`, [auth.userId, params.id]);
    await client.query('COMMIT');
    const [updated] = await query(`SELECT * FROM conversions WHERE id = $1`, [params.id]);
    return ok(updated);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
