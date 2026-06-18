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
  const lines = await query(
    `SELECT grl.grn_id, grl.qty_received, grl.unit_cost,
            pol.item_id, i.sku, i.name AS item_name, i.uom, i.tracking_mode
       FROM goods_receipt_lines grl
       JOIN purchase_order_lines pol ON pol.id = grl.po_line_id
       JOIN items i ON i.id = pol.item_id
      WHERE grl.grn_id = ANY($1::uuid[])
      ORDER BY grl.line_no`,
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

  return ok(grns.map((g) => ({ ...g, lines: byGrn.get(String(g.id)) ?? [] })));
}
