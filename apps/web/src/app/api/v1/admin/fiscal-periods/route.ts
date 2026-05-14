import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);

    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('company_id');
    if (!companyId) return err('company_id required', 400);

    const rows = await query<{
      id: string; period_name: string; start_date: string; end_date: string;
      status: string; fiscal_year_id: string | null; locked_at: string | null;
    }>(
      `SELECT id, period_name, start_date, end_date, status, fiscal_year_id, locked_at
         FROM fiscal_periods
        WHERE company_id = $1
        ORDER BY start_date`,
      [companyId]
    );

    return ok(rows);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const body = await req.json();
    const { company_id, period_name, start_date, end_date, fiscal_year_id } = body;
    if (!company_id || !period_name || !start_date || !end_date) {
      return err('company_id, period_name, start_date, end_date required', 400);
    }

    const [period] = await query<{ id: string; period_name: string }>(
      `INSERT INTO fiscal_periods (company_id, period_name, start_date, end_date, fiscal_year_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, period_name`,
      [company_id, period_name, start_date, end_date, fiscal_year_id ?? null]
    );

    return ok(period, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
