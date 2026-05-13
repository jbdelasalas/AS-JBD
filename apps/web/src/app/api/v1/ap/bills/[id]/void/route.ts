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
    `SELECT id, company_id, status, amount_paid FROM bills WHERE id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Bill ${params.id} not found`, 404);
  const bill = rows[0] as Record<string, unknown>;

  if (!['draft','approved'].includes(bill.status as string)) {
    return err(`Bill is ${bill.status} — only draft or approved bills can be voided`, 400);
  }
  if (Number(bill.amount_paid) > 0) {
    return err('Cannot void a bill with payments applied', 400);
  }

  const paymentCheck = await query(
    `SELECT id FROM bill_payment_applications WHERE bill_id = $1 LIMIT 1`,
    [params.id],
  );
  if (paymentCheck.length) return err('Cannot void a bill with payments applied', 400);

  const updated = await query(
    `UPDATE bills SET status = 'voided', updated_at = now() WHERE id = $1 RETURNING *`,
    [params.id],
  );

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.userId, bill.company_id, 'void', 'bill', params.id],
  ).catch(() => {});

  return ok(updated[0]);
}
