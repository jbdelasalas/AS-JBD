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
    // Mirror source deduction to stock_balances
    if (srcWarehouseId) {
      await client.query(
        `UPDATE stock_balances SET
           qty_on_hand = GREATEST(0, qty_on_hand - $1),
           last_movement_at = now()
         WHERE item_id = $2 AND warehouse_id = $3`,
        [srcKgs, rec.source_item_id, srcWarehouseId],
      );
    }

    // Add output inventory
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
      // Mirror output addition to stock_balances
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
      }
    }

    await client.query(`UPDATE conversions SET status='posted', posted_by=$1, posted_at=now() WHERE id=$2`, [auth.userId, params.id]);
    await client.query('COMMIT');
    const [updated] = await query(`SELECT * FROM conversions WHERE id = $1`, [params.id]);
    return ok(updated);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
