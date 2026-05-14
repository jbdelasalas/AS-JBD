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
      `SELECT * FROM trial_balance($1, $2::timestamptz, $3::uuid)`,
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
