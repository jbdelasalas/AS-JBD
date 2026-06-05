export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const rows = await query(
    `SELECT id, company_id, status FROM purchase_orders WHERE id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Purchase order ${params.id} not found`, 404);
  const po = rows[0] as Record<string, unknown>;

  if (['received','closed','cancelled'].includes(po.status as string)) {
    return err(`PO is ${po.status} — cannot cancel`, 400);
  }

  const [{ grn_count }] = await query<{ grn_count: number }>(
    `SELECT count(*)::int AS grn_count FROM goods_receipts WHERE po_id = $1`,
    [params.id],
  );
  if (Number(grn_count) > 0) {
    return err('Cannot cancel: goods have already been received against this PO. Delete the GRN(s) first.', 409);
  }

  const updated = await query(
    `UPDATE purchase_orders SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
    [params.id],
  );

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.userId, po.company_id, 'cancel', 'purchase_order', params.id],
  ).catch(() => {});

  return ok(updated[0]);
}
