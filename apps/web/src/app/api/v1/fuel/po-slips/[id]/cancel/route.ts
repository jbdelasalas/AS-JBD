export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Cancel a slip (spoiled booklet page, trip called off, wrong details after
// printing). The row and its booklet number stay on file for the audit trail.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const dto = await request.json().catch(() => ({} as Record<string, unknown>));
  const reason = (dto.reason as string)?.trim();
  if (!reason) return err('reason is required to cancel a slip', 400);

  const [slip] = await query<{ status: string; company_id: string }>(
    `SELECT status, company_id FROM fuel_po_slips WHERE id = $1`,
    [params.id],
  );
  if (!slip) return err('Slip not found', 404);
  if (slip.status === 'cancelled') return err('Slip is already cancelled', 409);
  // A redeemed slip has real fuel and money behind it — reversing that is an
  // accounting correction, not a cancellation.
  if (slip.status === 'redeemed') {
    return err('Redeemed slips cannot be cancelled — post a correcting adjustment instead', 409);
  }

  const [updated] = await query<{ id: string; slip_no: string; status: string }>(
    `UPDATE fuel_po_slips
        SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3
      WHERE id = $1
      RETURNING id, slip_no, status`,
    [params.id, auth.userId, reason],
  );

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
     VALUES ($1,$2,'cancel','fuel_po_slip',$3)`,
    [auth.userId, slip.company_id, params.id],
  ).catch(() => {});

  return ok(updated);
}
