export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { receivingTime } from '@/lib/routing/types';

// Changes when this one order may be delivered. Receiving hours are logistics,
// not money, so they stay editable after approval — until the order is
// delivered, closed or cancelled. Blank both to fall back to the client's
// usual hours from the customer record.

const LOCKED = new Set(['fully_delivered', 'closed', 'cancelled']);

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: { receiving_from?: unknown; receiving_to?: unknown };
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  let from: string | null, to: string | null;
  try {
    from = receivingTime(dto.receiving_from);
    to = receivingTime(dto.receiving_to);
  } catch (e) {
    return err((e as Error).message, 400);
  }

  const [so] = await query<{ id: string; company_id: string; order_no: string; status: string }>(
    `SELECT id, company_id, order_no, status FROM sales_orders WHERE id = $1`,
    [params.id],
  );
  if (!so) return err('Sales order not found', 404);
  if (LOCKED.has(so.status)) return err(`Order ${so.order_no} is ${so.status.replace(/_/g, ' ')} — receiving hours can no longer change`, 409);

  await query(
    `UPDATE sales_orders SET receiving_from = $1, receiving_to = $2, updated_at = now() WHERE id = $3`,
    [from, to, so.id],
  );
  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
     VALUES ($1,$2,'update','sales_order_receiving_hours',$3,$4)`,
    [auth.userId, so.company_id, so.id, JSON.stringify({ receiving_from: from, receiving_to: to })],
  ).catch(() => {});

  return ok({ id: so.id, receiving_from: from, receiving_to: to });
}
