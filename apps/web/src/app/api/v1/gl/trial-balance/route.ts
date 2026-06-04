export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  const asOfDate = searchParams.get('as_of_date') ?? new Date().toISOString().split('T')[0];

  if (!companyId) return err('company_id is required', 400);

  const rows = await query<{
    account_code: string; account_name: string; account_type: string;
    debit: number; credit: number;
  }>(
    `SELECT a.code  AS account_code,
            a.name  AS account_name,
            a.account_type,
            COALESCE(SUM(jel.debit ),  0)::float AS debit,
            COALESCE(SUM(jel.credit), 0)::float AS credit
       FROM accounts a
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.status = 'posted'
                                     AND je.entry_date <= $2::date
      WHERE a.company_id = $1
      GROUP BY a.id, a.code, a.name, a.account_type
      HAVING COALESCE(SUM(jel.debit), 0) <> 0 OR COALESCE(SUM(jel.credit), 0) <> 0
      ORDER BY a.code`,
    [companyId, asOfDate],
  );

  const total_debit  = rows.reduce((s, r) => s + r.debit,  0);
  const total_credit = rows.reduce((s, r) => s + r.credit, 0);

  return ok({
    as_of: asOfDate,
    rows,
    total_debit,
    total_credit,
    is_balanced: Math.abs(total_debit - total_credit) < 0.005,
  });
}
