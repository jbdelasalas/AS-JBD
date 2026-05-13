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
    `SELECT id, company_id, status FROM bills WHERE id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Bill ${params.id} not found`, 404);
  const bill = rows[0] as Record<string, unknown>;

  if (!['draft','pending_approval'].includes(bill.status as string)) {
    return err(`Bill is ${bill.status} — only draft or pending_approval bills can be approved`, 400);
  }

  const updated = await query(
    `UPDATE bills
        SET status = 'approved', approved_by = $2, approved_at = now(), posted_at = now(), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [params.id, auth.userId],
  );

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.userId, bill.company_id, 'approve', 'bill', params.id],
  ).catch(() => {});

  return ok(updated[0]);
}
