export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return { ...r, total: Number(r.total) };
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `er.company_id = $1`;

  const status = searchParams.get('status');
  const employeeId = searchParams.get('employee_id');
  if (status) { params.push(status); where += ` AND er.status = $${params.length}`; }
  if (employeeId) { params.push(employeeId); where += ` AND er.employee_id = $${params.length}`; }

  params.push(limit, offset);
  const rows = await query(
    `SELECT er.id, er.er_no, er.report_date, er.period_from, er.period_to,
            er.purpose, er.total, er.status,
            e.full_name AS employee_name, e.employee_no
       FROM employee_expense_reports er
       JOIN employees e ON e.id = er.employee_id
      WHERE ${where}
      ORDER BY er.report_date DESC, er.er_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM employee_expense_reports er WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows.map((r) => mapRow(r as Record<string, unknown>)),
    total: countRows[0].c,
    page: Math.floor(offset / limit) + 1,
    page_size: limit,
  });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const lines = dto.lines as Array<Record<string, unknown>>;
  if (!lines?.length) return err('Expense report must have at least one line', 400);

  const companyId = dto.company_id as string;
  const employeeId = dto.employee_id as string;

  const empRows = await query(
    `SELECT id FROM employees WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [employeeId, companyId],
  );
  if (!empRows[0]) return err('Employee not found or inactive', 404);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = $2 AND is_active = true
        RETURNING prefix, current_number`,
      [companyId, 'expense_report'],
    );
    if (!seriesRows.rows[0]) {
      await client.query('ROLLBACK');
      return err('No active document series for expense_report', 400);
    }
    const erNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const total = (lines as Array<Record<string, unknown>>).reduce(
      (s, l) => s + Number(l.amount ?? 0), 0,
    );

    const headerRows = await client.query(
      `INSERT INTO employee_expense_reports
         (company_id, branch_id, er_no, employee_id, report_date, period_from, period_to,
          purpose, notes, total, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11) RETURNING *`,
      [
        companyId, dto.branch_id ?? null, erNo, employeeId,
        dto.report_date, dto.period_from ?? null, dto.period_to ?? null,
        dto.purpose ?? null, dto.notes ?? null,
        total.toFixed(2), auth.userId,
      ],
    );
    const header = headerRows.rows[0];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO expense_report_lines
           (er_id, line_no, expense_account_id, description, receipt_date, amount, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          header.id, i + 1,
          l.expense_account_id ?? null,
          l.description,
          l.receipt_date,
          Number(l.amount ?? 0).toFixed(2),
          l.notes ?? null,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [auth.userId, companyId, 'create', 'expense_report', header.id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');

    const fullHeader = await query(
      `SELECT er.*, e.full_name AS employee_name, e.employee_no
         FROM employee_expense_reports er
         JOIN employees e ON e.id = er.employee_id
        WHERE er.id = $1 LIMIT 1`,
      [header.id],
    );
    const erLines = await query(
      `SELECT erl.*, a.code AS account_code, a.name AS account_name
         FROM expense_report_lines erl
         LEFT JOIN accounts a ON a.id = erl.expense_account_id
        WHERE erl.er_id = $1 ORDER BY erl.line_no`,
      [header.id],
    );

    return ok({ ...mapRow(fullHeader[0] as Record<string, unknown>), lines: erLines }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
