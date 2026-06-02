export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (e) { return e as Response; }
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  const search = searchParams.get('search') ?? '';
  try {
    const rows = await query(
      `SELECT e.id, e.employee_no, e.full_name, e.email, e.phone,
              e.position, e.employment_type, e.hire_date, e.is_active,
              d.name AS department_name,
              u.email AS user_email
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.company_id = $1
          AND ($2 = '' OR e.full_name ILIKE '%' || $2 || '%'
                       OR e.employee_no ILIKE '%' || $2 || '%'
                       OR e.email ILIKE '%' || $2 || '%')
        ORDER BY e.employee_no`,
      [companyId, search],
    );
    return ok(rows);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function POST(req: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }
  const companyId = new URL(req.url).searchParams.get('company_id')
    ?? (await req.json().then((b: Record<string,unknown>) => b.company_id).catch(() => null));

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const {
      company_id, employee_no, full_name, email, phone,
      department_id, position, employment_type, hire_date, end_date,
      user_id, is_active = true, notes,
    } = body;

    if (!company_id || !employee_no || !full_name)
      return err('company_id, employee_no, and full_name are required', 400);

    const [emp] = await query<{ id: string }>(
      `INSERT INTO employees
         (company_id, user_id, employee_no, full_name, email, phone,
          department_id, position, employment_type, hire_date, end_date, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [company_id, user_id ?? null, employee_no, full_name,
       email ?? null, phone ?? null, department_id ?? null,
       position ?? null, employment_type ?? 'full_time',
       hire_date ?? null, end_date ?? null, is_active, notes ?? null],
    );
    return ok(emp, 201);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
