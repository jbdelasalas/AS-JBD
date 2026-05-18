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

  const asOf       = (searchParams.get('as_of') ?? new Date().toISOString()).slice(0, 10);
  const customerId = searchParams.get('customer_id') ?? null;

  try {
    const t0 = Date.now();

    const rows = await query<{
      customer_id: string; customer_name: string;
      balance: string; days_overdue: string; aging_bucket: string;
    }>(
      `SELECT
        ar.customer_id,
        ar.customer_name::text,
        ar.balance,
        GREATEST(($2::date - ar.due_date::date)::int, 0) AS days_overdue,
        CASE
          WHEN ar.balance <= 0                                     THEN 'current'
          WHEN ($2::date - ar.due_date::date) <= 0                 THEN 'current'
          WHEN ($2::date - ar.due_date::date) BETWEEN 1  AND 30    THEN '1-30'
          WHEN ($2::date - ar.due_date::date) BETWEEN 31 AND 60    THEN '31-60'
          WHEN ($2::date - ar.due_date::date) BETWEEN 61 AND 90    THEN '61-90'
          ELSE '91+'
        END AS aging_bucket
       FROM v_ar_open_balance ar
       WHERE ar.company_id = $1
         AND ar.balance > 0
         AND ($3::uuid IS NULL OR ar.customer_id = $3::uuid)`,
      [companyId, asOf, customerId],
    );

    // Aggregate into customer-level summary rows
    const byCustomer: Record<string, {
      customer_id: string; customer_name: string; customer_tin: string;
      current_amt: number; days_1_30: number; days_31_60: number;
      days_61_90: number; days_91_plus: number; total_outstanding: number;
    }> = {};

    for (const r of rows) {
      if (!byCustomer[r.customer_id]) {
        byCustomer[r.customer_id] = {
          customer_id: r.customer_id, customer_name: r.customer_name, customer_tin: '',
          current_amt: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_plus: 0, total_outstanding: 0,
        };
      }
      const bal = Number(r.balance);
      const c = byCustomer[r.customer_id];
      c.total_outstanding += bal;
      if (r.aging_bucket === 'current') c.current_amt += bal;
      else if (r.aging_bucket === '1-30')  c.days_1_30 += bal;
      else if (r.aging_bucket === '31-60') c.days_31_60 += bal;
      else if (r.aging_bucket === '61-90') c.days_61_90 += bal;
      else                                 c.days_91_plus += bal;
    }

    const summary = Object.values(byCustomer).sort((a, b) => b.total_outstanding - a.total_outstanding);

    const grandTotal = summary.reduce((acc, c) => ({
      current_amt:     acc.current_amt     + c.current_amt,
      days_1_30:       acc.days_1_30       + c.days_1_30,
      days_31_60:      acc.days_31_60      + c.days_31_60,
      days_61_90:      acc.days_61_90      + c.days_61_90,
      days_91_plus:    acc.days_91_plus    + c.days_91_plus,
      total_outstanding: acc.total_outstanding + c.total_outstanding,
    }), { current_amt: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_plus: 0, total_outstanding: 0 });

    return ok({
      as_of: asOf,
      rows: summary,
      grand_total: grandTotal,
      duration_ms: Date.now() - t0,
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
