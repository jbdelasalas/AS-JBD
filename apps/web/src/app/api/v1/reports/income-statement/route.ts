export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const startDate = searchParams.get('start_date');
  const endDate   = searchParams.get('end_date');
  if (!startDate || !endDate) return err('start_date and end_date are required', 400);

  try {
    const t0 = Date.now();
    const rows = await query<{
      account_type: string; account_code: string; account_name: string; normal_side: string;
      period_debit: string; period_credit: string; net_amount: string;
    }>(
      `WITH period_gl AS (
        SELECT g.*
        FROM v_gl_detail g
        WHERE g.company_id = $1
          AND g.entry_date BETWEEN $2::date AND $3::date
          AND g.voided_at IS NULL
      )
      SELECT
        a.account_type::text  AS account_type,
        a.code::text          AS account_code,
        a.name::text          AS account_name,
        at.normal_side::text  AS normal_side,
        COALESCE(SUM(p.debit),  0)::numeric(18,4) AS period_debit,
        COALESCE(SUM(p.credit), 0)::numeric(18,4) AS period_credit,
        CASE WHEN at.normal_side = 'credit'
          THEN (COALESCE(SUM(p.credit), 0) - COALESCE(SUM(p.debit), 0))
          ELSE (COALESCE(SUM(p.debit),  0) - COALESCE(SUM(p.credit), 0))
        END::numeric(18,4) AS net_amount
      FROM accounts a
      JOIN account_types at ON at.code = a.account_type
      LEFT JOIN period_gl p ON p.account_id = a.id
      WHERE a.company_id = $1
        AND a.is_active = true
        AND at.is_balance_sheet = false
      GROUP BY a.id, a.account_type, a.code, a.name, at.normal_side
      HAVING COALESCE(SUM(p.debit), 0) + COALESCE(SUM(p.credit), 0) > 0
      ORDER BY a.account_type, a.code`,
      [companyId, startDate, endDate],
    );

    const mapped = rows.map((r) => ({
      ...r,
      period_debit:  Number(r.period_debit),
      period_credit: Number(r.period_credit),
      net_amount:    Number(r.net_amount),
    }));

    const revenue  = mapped.filter((r) => r.normal_side === 'credit');
    const expenses = mapped.filter((r) => r.normal_side === 'debit');
    const totalRevenue  = revenue.reduce((s, r) => s + r.net_amount, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.net_amount, 0);

    const byType: Record<string, typeof mapped> = {};
    for (const r of mapped) { (byType[r.account_type] ??= []).push(r); }

    return ok({
      start_date: startDate,
      end_date: endDate,
      rows: mapped,
      by_type: byType,
      total_revenue:  parseFloat(totalRevenue.toFixed(2)),
      total_expenses: parseFloat(totalExpenses.toFixed(2)),
      net_income:     parseFloat((totalRevenue - totalExpenses).toFixed(2)),
      duration_ms: Date.now() - t0,
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
