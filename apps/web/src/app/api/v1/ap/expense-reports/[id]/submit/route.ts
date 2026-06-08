export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return { ...r, total: Number(r.total) };
}

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

  const id = params.id;

  const erRows = await query(
    `SELECT er.*, e.full_name AS employee_name
       FROM employee_expense_reports er
       JOIN employees e ON e.id = er.employee_id
      WHERE er.id = $1 LIMIT 1`,
    [id],
  );
  if (!erRows[0]) return err(`Expense report ${id} not found`, 404);
  const er = erRows[0] as Record<string, unknown>;

  if (er.status !== 'draft') return err(`Cannot submit: report is ${er.status}`, 400);

  await query(
    `UPDATE employee_expense_reports SET status = 'pending_approval' WHERE id = $1`,
    [id],
  );

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [auth.userId, er.company_id, 'submit_approval', 'expense_report', id],
  ).catch(() => {/* non-fatal */});

  const updated = await query(
    `SELECT er.*, e.full_name AS employee_name, e.employee_no
       FROM employee_expense_reports er
       JOIN employees e ON e.id = er.employee_id
      WHERE er.id = $1 LIMIT 1`,
    [id],
  );
  return ok(mapRow(updated[0] as Record<string, unknown>));
}
