export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return { ...r, total: Number(r.total) };
}

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
    `SELECT er.*, e.full_name AS employee_name, e.employee_no
       FROM employee_expense_reports er
       JOIN employees e ON e.id = er.employee_id
      WHERE er.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!headers[0]) return err(`Expense report ${params.id} not found`, 404);

  const lines = await query(
    `SELECT erl.*, a.code AS account_code, a.name AS account_name
       FROM expense_report_lines erl
       LEFT JOIN accounts a ON a.id = erl.expense_account_id
      WHERE erl.er_id = $1 ORDER BY erl.line_no`,
    [params.id],
  );

  return ok({ ...mapRow(headers[0] as Record<string, unknown>), lines });
}

// Save the cash-count / fund-accountability reconciliation on the report header.
// Body: { cash_count: {...}, fund_accountability: number }
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return err('Invalid request body', 400); }

  const cashCount = body.cash_count ?? null;
  const fundAcct = body.fund_accountability != null && body.fund_accountability !== ''
    ? Number(body.fund_accountability) : null;

  try {
    const [row] = await query<{ id: string }>(
      `UPDATE employee_expense_reports
          SET cash_count = $1::jsonb, fund_accountability = $2
        WHERE id = $3 RETURNING id`,
      [cashCount != null ? JSON.stringify(cashCount) : null, fundAcct, params.id],
    );
    if (!row) return err('Expense report not found', 404);
    return ok(row);
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to save cash count', 500);
  }
}
