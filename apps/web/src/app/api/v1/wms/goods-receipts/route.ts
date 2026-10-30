export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Posted goods receipts (with their lines) available to put away. Used to
// pre-fill a new put-away so the operator just assigns bins.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `gr.company_id = $1 AND gr.status = 'posted'`;
  const warehouseId = searchParams.get('warehouse_id');
  if (warehouseId) { params.push(warehouseId); where += ` AND gr.warehouse_id = $${params.length}`; }

  const grns = await query(
    `SELECT gr.id, gr.grn_no, gr.warehouse_id, gr.receipt_date
       FROM goods_receipts gr
      WHERE ${where}
      ORDER BY gr.receipt_date DESC, gr.grn_no DESC
      LIMIT 200`,
    params,
  );
  if (!grns.length) return ok([]);

  const ids = grns.map((g) => g.id);
  // Per item: received minus what draft/posted put-aways already took.
  const lines = await query(
    `WITH rcv AS (
       SELECT grl.grn_id, pol.item_id, MIN(grl.line_no) AS line_no, SUM(grl.qty_received) AS qty,
              SUM(grl.qty_received * grl.unit_cost) / NULLIF(SUM(grl.qty_received), 0) AS unit_cost
         FROM goods_receipt_lines grl
         JOIN purchase_order_lines pol ON pol.id = grl.po_line_id
        WHERE grl.grn_id = ANY($1::uuid[])
        GROUP BY grl.grn_id, pol.item_id
     ), used AS (
       SELECT p.grn_id, pl.item_id, SUM(pl.qty) AS qty
         FROM putaway_lines pl JOIN putaways p ON p.id = pl.putaway_id
        WHERE p.grn_id = ANY($1::uuid[]) AND p.status <> 'cancelled'
        GROUP BY p.grn_id, pl.item_id
     )
     SELECT rcv.grn_id, rcv.qty - COALESCE(used.qty, 0) AS qty_received, rcv.unit_cost,
            rcv.item_id, i.sku, i.name AS item_name, i.uom, i.tracking_mode
       FROM rcv
       JOIN items i ON i.id = rcv.item_id
       LEFT JOIN used ON used.grn_id = rcv.grn_id AND used.item_id = rcv.item_id
      WHERE rcv.qty - COALESCE(used.qty, 0) > 0
      ORDER BY rcv.line_no`,
    [ids],
  );

  const byGrn = new Map<string, unknown[]>();
  for (const l of lines) {
    const arr = byGrn.get(String(l.grn_id)) ?? [];
    arr.push({
      item_id: l.item_id, sku: l.sku, item_name: l.item_name, uom: l.uom,
      tracking_mode: l.tracking_mode,
      qty: Number(l.qty_received), unit_cost: Number(l.unit_cost),
    });
    byGrn.set(String(l.grn_id), arr);
  }

  // Fully put-away receipts drop off the list.
  return ok(grns.filter((g) => byGrn.has(String(g.id))).map((g) => ({ ...g, lines: byGrn.get(String(g.id))! })));
}
