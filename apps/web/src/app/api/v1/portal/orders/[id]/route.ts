export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { resolvePortalCustomer, PORTAL_STAGES } from '@/lib/portal-helpers';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const res = await resolvePortalCustomer(auth);
  if ('response' in res) return res.response;
  const { customer } = res;

  // Scope to this customer's own portal orders only.
  const rows = await query<Record<string, unknown>>(
    `SELECT o.id, o.order_no, o.order_date, o.delivery_date, o.reference,
            o.subtotal, o.total, o.priority, o.portal_status, o.notes,
            o.approved_at, o.allocated_at, o.truck_assigned_at, o.truck_no,
            o.driver, o.loaded_at, o.dr_number, o.dr_photo_url,
            o.dispatched_at, o.gps_url, o.delivered_at, o.created_at
       FROM sales_orders o
      WHERE o.id = $1 AND o.customer_id = $2 AND o.is_portal_order = true`,
    [params.id, customer.id],
  );
  if (!rows[0]) return err('Order not found', 404);
  const order = rows[0];

  const lines = await query<Record<string, unknown>>(
    `SELECT l.line_no, l.item_id, l.description, l.quantity, l.unit_price, l.line_total, i.uom
       FROM sales_order_lines l
       JOIN items i ON i.id = l.item_id
      WHERE l.order_id = $1
      ORDER BY l.line_no ASC`,
    [params.id],
  );

  // Build the 7-stage timeline: which stages are done (have a timestamp).
  const stampByStage: Record<string, unknown> = {
    'Pending': order.created_at,
    'Approved': order.approved_at,
    'Allocated': order.allocated_at,
    'Truck Assigned': order.truck_assigned_at,
    'Ready to Dispatch': order.loaded_at,
    'Out for Delivery': order.dispatched_at,
    'Delivered': order.delivered_at,
  };
  const currentStatus = (order.portal_status as string) ?? 'Pending';
  const currentIdx = PORTAL_STAGES.indexOf(currentStatus as never);
  const timeline = PORTAL_STAGES.map((stage, idx) => ({
    stage,
    at: stampByStage[stage] ?? null,
    done: idx <= currentIdx && currentIdx >= 0,
    current: stage === currentStatus,
  }));

  return ok({
    order: {
      ...order,
      subtotal: Number(order.subtotal),
      total: Number(order.total),
      portal_status: currentStatus,
    },
    lines: lines.map((l) => ({
      line_no: l.line_no,
      item_id: l.item_id,
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      line_total: Number(l.line_total),
      uom: l.uom,
    })),
    timeline,
  });
}
