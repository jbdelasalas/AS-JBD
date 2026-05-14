import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);

    const [fy] = await query<Record<string, unknown>>(
      `SELECT id, company_id, year, start_date, end_date, is_closed, closed_at, created_at
         FROM fiscal_years WHERE id = $1`,
      [params.id]
    );
    if (!fy) return err('Not found', 404);

    const periods = await query<{
      id: string; period_name: string; start_date: string; end_date: string; status: string;
    }>(
      `SELECT id, period_name, start_date, end_date, status
         FROM fiscal_periods WHERE fiscal_year_id = $1 ORDER BY start_date`,
      [params.id]
    );

    return ok({ ...fy, periods });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
