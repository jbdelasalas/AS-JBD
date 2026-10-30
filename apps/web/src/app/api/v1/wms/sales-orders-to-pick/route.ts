export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { PICKABLE_SO_STATUSES, SO_OPEN_TO_PICK_SQL } from '@/lib/wms';

// Approved sales orders (with their lines) that can be picked from a warehouse.
// Lines show what is still open after deliveries and existing pick lists, and
// fully picked orders are left out, so the same order can't be picked twice.
// Orders tied to another warehouse are left out; orders with no warehouse show.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  const warehouseId = searchParams.get('warehouse_id');
  if (!companyId || !warehouseId) return err('company_id and warehouse_id are required', 400);

  const orders = await query(
    `SELECT so.id, so.order_no, so.order_date, so.delivery_date, so.status, so.warehouse_id,
            c.name AS customer_name
       FROM sales_orders so
       JOIN customers c ON c.id = so.customer_id
      WHERE so.company_id = $1 AND so.status = ANY($2::text[])
        AND (so.warehouse_id IS NULL OR so.warehouse_id = $3)
      ORDER BY so.delivery_date NULLS LAST, so.order_no
      LIMIT 300`,
    [companyId, PICKABLE_SO_STATUSES, warehouseId],
  );
  if (!orders.length) return ok([]);

  const lines = await query(
    `SELECT x.order_id, x.item_id, x.ordered, x.open_qty, i.sku, i.name AS item_name, i.uom
       FROM (${SO_OPEN_TO_PICK_SQL}) x
       JOIN items i ON i.id = x.item_id
      WHERE x.open_qty > 0
      ORDER BY x.line_no`,
    [orders.map((o) => o.id)],
  );

  const byOrder = new Map<string, unknown[]>();
  for (const l of lines) {
    const arr = byOrder.get(String(l.order_id)) ?? [];
    arr.push({ item_id: l.item_id, sku: l.sku, item_name: l.item_name, uom: l.uom, ordered: Number(l.ordered), open_qty: Number(l.open_qty) });
    byOrder.set(String(l.order_id), arr);
  }

  return ok(orders.filter((o) => byOrder.has(String(o.id))).map((o) => ({ ...o, lines: byOrder.get(String(o.id))! })));
}
