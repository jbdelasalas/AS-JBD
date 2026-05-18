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

  const asOf = searchParams.get('as_of') ?? new Date().toISOString();
  const branchId = searchParams.get('branch_id') ?? null;
  const excludeZero = searchParams.get('exclude_zero') === 'true';

  try {
    const t0 = Date.now();
    const rows = await query<{
      account_code: string; account_name: string; account_type: string;
      is_balance_sheet: boolean; normal_side: string;
      period_debit: string; period_credit: string; ending_balance: string;
    }>(
      `WITH filtered_gl AS (
        SELECT g.*
        FROM v_gl_detail g
        WHERE g.company_id = $1
          AND g.posted_at <= $2::timestamptz
          AND (g.voided_at IS NULL OR g.voided_at > $2::timestamptz)
          AND ($3::uuid IS NULL OR g.branch_id = $3::uuid)
      )
      SELECT
        a.code::text            AS account_code,
        a.name::text            AS account_name,
        a.account_type::text    AS account_type,
        at.is_balance_sheet,
        at.normal_side::text    AS normal_side,
        COALESCE(SUM(f.debit),  0)::numeric(18,4) AS period_debit,
        COALESCE(SUM(f.credit), 0)::numeric(18,4) AS period_credit,
        (COALESCE(SUM(f.debit), 0) - COALESCE(SUM(f.credit), 0))::numeric(18,4) AS ending_balance
      FROM accounts a
      JOIN account_types at ON at.code = a.account_type
      LEFT JOIN filtered_gl f ON f.account_id = a.id
      WHERE a.company_id = $1
        AND a.is_active = true
      GROUP BY a.id, a.code, a.name, a.account_type, at.is_balance_sheet, at.normal_side
      ORDER BY a.code`,
      [companyId, asOf, branchId],
    );

    const mapped = rows.map((r) => ({
      ...r,
      period_debit: Number(r.period_debit),
      period_credit: Number(r.period_credit),
      ending_balance: Number(r.ending_balance),
    })).filter((r) => !excludeZero || Math.abs(r.ending_balance) > 0.001);

    const totalDebit  = mapped.reduce((s, r) => s + r.period_debit, 0);
    const totalCredit = mapped.reduce((s, r) => s + r.period_credit, 0);

    return ok({
      as_of: asOf,
      rows: mapped,
      total_debit: parseFloat(totalDebit.toFixed(4)),
      total_credit: parseFloat(totalCredit.toFixed(4)),
      reconciles: Math.abs(totalDebit - totalCredit) < 0.01,
      duration_ms: Date.now() - t0,
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
