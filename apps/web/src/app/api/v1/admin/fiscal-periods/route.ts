export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('company_id');
    if (!companyId) return err('company_id required', 400);

    const rows = await query<{
      id: string; period_name: string; year: number; period: number;
      start_date: string; end_date: string; status: string;
      fiscal_year_id: string | null; locked_at: string | null;
    }>(
      `SELECT id,
              (year::text || '-' || LPAD(period::text, 2, '0')) AS period_name,
              year, period, start_date, end_date, status, fiscal_year_id, locked_at
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
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const body = await req.json();
    const { company_id, year, period, start_date, end_date, fiscal_year_id } = body;
    if (!company_id || !year || !period || !start_date || !end_date) {
      return err('company_id, year, period, start_date, end_date required', 400);
    }

    const [fp] = await query<{ id: string; year: number; period: number }>(
      `INSERT INTO fiscal_periods (company_id, year, period, start_date, end_date, fiscal_year_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, year, period`,
      [company_id, year, period, start_date, end_date, fiscal_year_id ?? null]
    );

    return ok(fp, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
