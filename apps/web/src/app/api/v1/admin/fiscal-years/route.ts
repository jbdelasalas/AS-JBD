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
      id: string; year: number; start_date: string; end_date: string;
      is_closed: boolean; closed_at: string | null; period_count: number;
    }>(
      `SELECT fy.id, fy.year, fy.start_date, fy.end_date, fy.is_closed, fy.closed_at,
              COUNT(fp.id)::int AS period_count
         FROM fiscal_years fy
         LEFT JOIN fiscal_periods fp ON fp.fiscal_year_id = fy.id
        WHERE fy.company_id = $1
        GROUP BY fy.id
        ORDER BY fy.year DESC`,
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

    const body = await req.json();
    const { company_id, year, start_date, end_date } = body;
    if (!company_id || !year || !start_date || !end_date) {
      return err('company_id, year, start_date, end_date required', 400);
    }

    const [fy] = await query<{ id: string; year: number }>(
      `INSERT INTO fiscal_years (company_id, year, start_date, end_date)
       VALUES ($1, $2, $3, $4)
       RETURNING id, year`,
      [company_id, year, start_date, end_date]
    );

    return ok(fy, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
