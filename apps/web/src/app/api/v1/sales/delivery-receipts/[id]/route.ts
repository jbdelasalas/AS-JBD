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

  const headers = await query(
    `SELECT dr.*, c.name AS customer_name, so.order_no, w.name AS warehouse_name
       FROM delivery_receipts dr
       JOIN customers c ON c.id = dr.customer_id
       JOIN sales_orders so ON so.id = dr.so_id
       JOIN warehouses w ON w.id = dr.warehouse_id
      WHERE dr.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!headers[0]) return err(`Delivery receipt ${params.id} not found`, 404);

  const lines = await query(
    `SELECT drl.*, i.sku AS item_sku, i.name AS item_name FROM delivery_receipt_lines drl JOIN items i ON i.id = drl.item_id WHERE drl.dr_id = $1 ORDER BY drl.line_no`,
    [params.id],
  );

  return ok({
    ...headers[0],
    lines: lines.map((l) => ({
      ...l,
      qty_delivered: Number((l as Record<string, unknown>).qty_delivered),
      unit_cost: Number((l as Record<string, unknown>).unit_cost),
    })),
  });
}
