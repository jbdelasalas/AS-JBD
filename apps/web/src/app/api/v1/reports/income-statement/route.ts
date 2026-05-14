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

  const branchId = searchParams.get('branch_id') ?? null;

  try {
    const t0 = Date.now();
    const rows = await query<{
      account_type: string; account_code: string; account_name: string;
      normal_side: string; period_debit: string; period_credit: string; net_amount: string;
    }>(
      `SELECT * FROM income_statement($1, $2::date, $3::date, $4::uuid)`,
      [companyId, startDate, endDate, branchId],
    );

    const mapped = rows.map((r) => ({
      ...r,
      period_debit: Number(r.period_debit),
      period_credit: Number(r.period_credit),
      net_amount: Number(r.net_amount),
    }));

    // Group by account type for P&L structure
    const byType: Record<string, typeof mapped> = {};
    for (const r of mapped) {
      if (!byType[r.account_type]) byType[r.account_type] = [];
      byType[r.account_type].push(r);
    }

    const totalRevenue  = mapped.filter((r) => r.normal_side === 'credit').reduce((s, r) => s + r.net_amount, 0);
    const totalExpenses = mapped.filter((r) => r.normal_side === 'debit').reduce((s, r) => s + r.net_amount, 0);

    return ok({
      start_date: startDate,
      end_date: endDate,
      rows: mapped,
      by_type: byType,
      total_revenue: parseFloat(totalRevenue.toFixed(2)),
      total_expenses: parseFloat(totalExpenses.toFixed(2)),
      net_income: parseFloat((totalRevenue - totalExpenses).toFixed(2)),
      duration_ms: Date.now() - t0,
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
