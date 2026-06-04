export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
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

  let headers: Record<string, unknown>[];
  try {
    headers = await query(
      `SELECT dr.*,
              c.name AS customer_name, c.payment_terms_days,
              so.order_no, so.id AS so_id,
              COALESCE(dr.branch_id, so.branch_id)           AS eff_branch_id,
              COALESCE(dr.building_id, so.building_id)       AS eff_building_id,
              COALESCE(dr.cost_center_id, so.cost_center_id) AS eff_cost_center_id,
              COALESCE(dr.grow_reference_id, so.grow_reference_id) AS eff_grow_reference_id,
              w.name AS warehouse_name
         FROM delivery_receipts dr
         JOIN customers c ON c.id = dr.customer_id
         JOIN sales_orders so ON so.id = dr.so_id
         JOIN warehouses w ON w.id = dr.warehouse_id
        WHERE dr.id = $1 LIMIT 1`,
      [params.id],
    ) as Record<string, unknown>[];
  } catch {
    // building_id / cost_center_id / grow_reference_id may not exist on delivery_receipts yet
    headers = await query(
      `SELECT dr.*,
              c.name AS customer_name, c.payment_terms_days,
              so.order_no, so.id AS so_id,
              COALESCE(dr.branch_id, so.branch_id) AS eff_branch_id,
              so.building_id    AS eff_building_id,
              so.cost_center_id AS eff_cost_center_id,
              so.grow_reference_id AS eff_grow_reference_id,
              w.name AS warehouse_name
         FROM delivery_receipts dr
         JOIN customers c ON c.id = dr.customer_id
         JOIN sales_orders so ON so.id = dr.so_id
         JOIN warehouses w ON w.id = dr.warehouse_id
        WHERE dr.id = $1 LIMIT 1`,
      [params.id],
    ) as Record<string, unknown>[];
  }
  if (!headers[0]) return err(`Delivery receipt ${params.id} not found`, 404);

  let lines: Record<string, unknown>[];
  try {
    lines = await query(
      `SELECT drl.*, i.sku AS item_sku, i.name AS item_name, i.uom AS item_uom,
              sol.unit_price AS so_unit_price, sol.vat_rate AS so_vat_rate,
              sol.discount_pct AS so_discount_pct
         FROM delivery_receipt_lines drl
         JOIN items i ON i.id = drl.item_id
         LEFT JOIN sales_order_lines sol ON sol.id = drl.so_line_id
        WHERE drl.dr_id = $1
        ORDER BY drl.line_no`,
      [params.id],
    ) as Record<string, unknown>[];
  } catch {
    lines = await query(
      `SELECT drl.*, i.sku AS item_sku, i.name AS item_name
         FROM delivery_receipt_lines drl
         JOIN items i ON i.id = drl.item_id
        WHERE drl.dr_id = $1
        ORDER BY drl.line_no`,
      [params.id],
    ) as Record<string, unknown>[];
  }

  return ok({
    ...headers[0],
    lines: lines.map((l) => ({
      ...l,
      qty_delivered: Number((l as Record<string, unknown>).qty_delivered),
      unit_cost: Number((l as Record<string, unknown>).unit_cost),
    })),
  });
}
