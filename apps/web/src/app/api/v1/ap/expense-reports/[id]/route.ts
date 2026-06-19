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
    `SELECT er.*, e.full_name AS employee_name, e.employee_no,
            loc.name AS location_name, cc.name AS cost_center_name,
            fb.name  AS building_name, gr.name AS grow_reference_name
       FROM employee_expense_reports er
       JOIN employees e ON e.id = er.employee_id
       LEFT JOIN branches        loc ON loc.id = er.location_id
       LEFT JOIN cost_centers    cc  ON cc.id  = er.cost_center_id
       LEFT JOIN farm_buildings  fb  ON fb.id  = er.building_id
       LEFT JOIN grow_references gr  ON gr.id  = er.grow_reference_id
      WHERE er.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!headers[0]) return err(`Expense report ${params.id} not found`, 404);

  const lines = await query(
    `SELECT erl.*, a.code AS account_code, a.name AS account_name,
            loc.name AS location_name, cc.name AS cost_center_name,
            fb.name  AS building_name, gr.name AS grow_reference_name
       FROM expense_report_lines erl
       LEFT JOIN accounts        a   ON a.id   = erl.expense_account_id
       LEFT JOIN branches        loc ON loc.id = erl.location_id
       LEFT JOIN cost_centers    cc  ON cc.id  = erl.cost_center_id
       LEFT JOIN farm_buildings  fb  ON fb.id  = erl.building_id
       LEFT JOIN grow_references gr  ON gr.id  = erl.grow_reference_id
      WHERE erl.er_id = $1 ORDER BY erl.line_no`,
    [params.id],
  );

  return ok({ ...mapRow(headers[0] as Record<string, unknown>), lines });
}
