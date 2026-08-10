export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Approve & issue: the slip is signed by HR/Admin and handed to the employee.
// After this it is printed and physically out of the office, so the top half
// becomes read-only.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const [slip] = await query<{ status: string; company_id: string; created_by: string; issued_to_name: string }>(
    `SELECT status, company_id, created_by, issued_to_name FROM fuel_po_slips WHERE id = $1`,
    [params.id],
  );
  if (!slip) return err('Slip not found', 404);
  if (slip.status !== 'draft') return err(`Only draft slips can be issued (this one is ${slip.status})`, 409);

  const [updated] = await query<{ id: string; slip_no: string; status: string }>(
    `UPDATE fuel_po_slips
        SET status = 'issued', approved_by = $2, approved_at = now()
      WHERE id = $1
      RETURNING id, slip_no, status`,
    [params.id, auth.userId],
  );

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
     VALUES ($1,$2,'issue','fuel_po_slip',$3)`,
    [auth.userId, slip.company_id, params.id],
  ).catch(() => {});

  return ok(updated);
}
