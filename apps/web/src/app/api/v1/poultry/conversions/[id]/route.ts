export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT c.*, i.name AS source_item_name, i.sku AS source_sku,
              t.doc_no AS tally_sheet_no,
              po.po_no, s.name AS supplier_name,
              br.name  AS branch_name,
              tbr.name AS target_branch_name
         FROM conversions c
         JOIN items i ON i.id = c.source_item_id
         LEFT JOIN tally_sheets t   ON t.id   = c.tally_sheet_id
         LEFT JOIN purchase_orders po ON po.id = c.po_id
         LEFT JOIN suppliers s        ON s.id  = po.supplier_id
         LEFT JOIN branches br        ON br.id = c.branch_id
         LEFT JOIN branches tbr       ON tbr.id = c.target_branch_id
        WHERE c.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const outputs = await query(
      `SELECT o.*, i.name AS item_name, i.sku FROM conversion_outputs o
         JOIN items i ON i.id = o.output_item_id
        WHERE o.conversion_id = $1 ORDER BY o.line_no`, [params.id]);
    return ok({ ...hdr, outputs });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  if (!auth.isSuperadmin) return err('Forbidden — admin only', 403);

  const [rec] = await query<{ id: string; status: string; company_id: string; warehouse_id: string | null; source_item_id: string; source_heads: number; source_kgs: number; branch_id: string | null; target_branch_id: string | null }>(
    `SELECT id, status, company_id, warehouse_id, source_item_id, source_heads, source_kgs, branch_id, target_branch_id FROM conversions WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);

  const outputs = await query<{ output_item_id: string; heads: number; kgs: number }>(
    `SELECT output_item_id, heads, kgs FROM conversion_outputs WHERE conversion_id = $1`, [params.id]);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    if (rec.status === 'posted') {
      // Resolve warehouses for stock_balances reversal
      const cvSrcWhRow = rec.branch_id
        ? await client.query(`SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1`, [rec.branch_id])
        : { rows: [] };
      const cvTgtWhRow = (rec.target_branch_id ?? rec.branch_id)
        ? await client.query(`SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1`, [rec.target_branch_id ?? rec.branch_id])
        : { rows: [] };
      const cvSrcWhId: string | null = cvSrcWhRow.rows[0]?.id ?? null;
      const cvTgtWhId: string | null = cvTgtWhRow.rows[0]?.id ?? null;

      // Add source inventory back
      await client.query(
        `INSERT INTO poultry_inventory_balance (company_id, warehouse_id, item_id, qty_heads, qty_kgs, last_updated)
         VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (company_id, warehouse_id, item_id) DO UPDATE
           SET qty_heads = poultry_inventory_balance.qty_heads + $4,
               qty_kgs   = poultry_inventory_balance.qty_kgs   + $5,
               last_updated = now()`,
        [rec.company_id, rec.warehouse_id, rec.source_item_id, Number(rec.source_heads), Number(rec.source_kgs)],
      );
      if (cvSrcWhId) {
        await client.query(
          `UPDATE stock_balances SET
             qty_on_hand = GREATEST(0, qty_on_hand + $1),
             last_movement_at = now()
           WHERE item_id = $2 AND warehouse_id = $3`,
          [Number(rec.source_kgs), rec.source_item_id, cvSrcWhId],
        );
      }

      // Remove output inventory
      for (const o of outputs) {
        await client.query(
          `UPDATE poultry_inventory_balance SET
             qty_heads = GREATEST(0, qty_heads - $1),
             qty_kgs   = GREATEST(0, qty_kgs   - $2),
             last_updated = now()
           WHERE company_id = $3 AND warehouse_id IS NOT DISTINCT FROM $4 AND item_id = $5`,
          [Number(o.heads), Number(o.kgs), rec.company_id, rec.warehouse_id, o.output_item_id],
        );
        if (cvTgtWhId) {
          await client.query(
            `UPDATE stock_balances SET
               qty_on_hand = GREATEST(0, qty_on_hand - $1),
               last_movement_at = now()
             WHERE item_id = $2 AND warehouse_id = $3`,
            [Number(o.kgs), o.output_item_id, cvTgtWhId],
          );
        }
      }

      // Remove ledger entries
      await client.query(
        `DELETE FROM poultry_inventory_ledger WHERE source_type = 'conversion' AND source_id = $1`, [params.id]);
    }

    await client.query(`DELETE FROM conversion_outputs WHERE conversion_id = $1`, [params.id]);
    await client.query(`DELETE FROM conversions        WHERE id           = $1`, [params.id]);

    await client.query('COMMIT');
    return new Response(null, { status: 204 });
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
