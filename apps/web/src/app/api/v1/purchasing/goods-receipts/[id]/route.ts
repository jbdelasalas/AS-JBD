export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const rows = await query(
    `SELECT gr.*, po.po_no, s.name AS supplier_name, s.code AS supplier_code,
            br.code AS branch_code,    br.name AS branch_name,
            fb.code AS building_code,  fb.name AS building_name,
            cc.code AS cost_center_code, cc.name AS cost_center_name,
            gref.code AS grow_ref_code,  gref.name AS grow_ref_name
       FROM goods_receipts gr
       JOIN purchase_orders po ON po.id = gr.po_id
       JOIN suppliers s        ON s.id  = po.supplier_id
       LEFT JOIN branches br          ON br.id   = gr.branch_id
       LEFT JOIN farm_buildings fb    ON fb.id   = gr.building_id
       LEFT JOIN cost_centers cc      ON cc.id   = gr.cost_center_id
       LEFT JOIN grow_references gref ON gref.id = gr.grow_reference_id
      WHERE gr.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Goods receipt ${params.id} not found`, 404);

  const lines = await query(
    `SELECT grl.*, pol.description, pol.quantity AS po_qty, pol.unit_price,
            i.sku AS item_sku, i.name AS item_name, i.uom AS item_uom
       FROM goods_receipt_lines grl
       JOIN purchase_order_lines pol ON pol.id = grl.po_line_id
       LEFT JOIN items i ON i.id = pol.item_id
      WHERE grl.grn_id = $1
      ORDER BY grl.line_no`,
    [params.id],
  );

  return ok({
    ...rows[0],
    lines: lines.map((l) => {
      const row = l as Record<string, unknown>;
      return {
        ...row,
        qty_received: Number(row.qty_received),
        unit_cost: Number(row.unit_cost),
        po_qty: Number(row.po_qty),
        unit_price: Number(row.unit_price),
      };
    }),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  if (!auth.isSuperadmin) return err('Forbidden — admin only', 403);

  const [rec] = await query<{ id: string; po_id: string }>(`SELECT id, po_id FROM goods_receipts WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);

  // Block if any chick batch from this GRN is already in use (in_growing)
  const [{ cnt }] = await query<{ cnt: number }>(
    `SELECT count(*)::int AS cnt FROM chick_batches WHERE grn_id = $1 AND status != 'available'`,
    [params.id],
  );
  if (Number(cnt) > 0) return err('Cannot delete: one or more chick batches from this receipt are already in a grow cycle', 409);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Reverse qty_received on each PO line
    await client.query(
      `UPDATE purchase_order_lines pol
          SET qty_received = GREATEST(0, pol.qty_received - grl.qty_received)
         FROM goods_receipt_lines grl
        WHERE grl.grn_id = $1 AND pol.id = grl.po_line_id`,
      [params.id],
    );

    // Recalculate PO status (back to 'approved' if nothing received, else 'partial')
    await client.query(
      `UPDATE purchase_orders SET
         status = CASE
           WHEN (SELECT COALESCE(SUM(qty_received),0) FROM purchase_order_lines WHERE po_id = $1) = 0
           THEN 'approved'
           ELSE 'partial'
         END,
         updated_at = now()
       WHERE id = $1`,
      [rec.po_id],
    );

    // Delete chick batches created by this GRN (they are 'available' — safe to remove)
    await client.query(`DELETE FROM chick_batches WHERE grn_id = $1`, [params.id]);

    await client.query(`DELETE FROM goods_receipt_lines WHERE grn_id = $1`, [params.id]);
    await client.query(`DELETE FROM goods_receipts      WHERE id    = $1`, [params.id]);

    await client.query('COMMIT');
    return new Response(null, { status: 204 });
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
