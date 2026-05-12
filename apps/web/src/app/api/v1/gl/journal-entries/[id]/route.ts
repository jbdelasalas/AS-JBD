export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

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
    `SELECT je.*, fp.year AS period_year, fp.period AS period_number
       FROM journal_entries je
       LEFT JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
      WHERE je.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!headers[0]) return err(`Journal entry ${params.id} not found`, 404);

  const lines = await query(
    `SELECT jel.*, a.code AS account_code, a.name AS account_name
       FROM journal_entry_lines jel
       JOIN accounts a ON a.id = jel.account_id
      WHERE jel.entry_id = $1
      ORDER BY jel.line_no`,
    [params.id],
  );

  return ok({
    ...headers[0],
    lines: lines.map((l) => ({
      ...l,
      debit: Number((l as Record<string, unknown>).debit),
      credit: Number((l as Record<string, unknown>).credit),
    })),
  });
}
