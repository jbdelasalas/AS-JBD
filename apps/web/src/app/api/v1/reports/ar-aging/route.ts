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

  const asOf       = searchParams.get('as_of') ?? new Date().toISOString().slice(0, 10);
  const customerId = searchParams.get('customer_id') ?? null;

  try {
    const t0 = Date.now();
    const rows = await query<{
      customer_id: string; customer_name: string; invoice_id: string;
      invoice_no: string; invoice_date: string; due_date: string;
      original: string; paid: string; balance: string;
      days_overdue: number; aging_bucket: string;
    }>(
      `SELECT * FROM ar_aging($1, $2::date, $3::uuid)`,
      [companyId, asOf, customerId],
    );

    const mapped = rows.map((r) => ({
      ...r,
      original: Number(r.original),
      paid: Number(r.paid),
      balance: Number(r.balance),
      days_overdue: Number(r.days_overdue),
    }));

    // Summarise by customer
    const byCustomer: Record<string, {
      customer_id: string; customer_name: string;
      current: number; d1_30: number; d31_60: number; d61_90: number; d91plus: number; total: number;
    }> = {};
    for (const r of mapped) {
      if (!byCustomer[r.customer_id]) {
        byCustomer[r.customer_id] = {
          customer_id: r.customer_id, customer_name: r.customer_name,
          current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91plus: 0, total: 0,
        };
      }
      const cust = byCustomer[r.customer_id];
      cust.total += r.balance;
      if (r.aging_bucket === 'current') cust.current += r.balance;
      else if (r.aging_bucket === '1-30')  cust.d1_30 += r.balance;
      else if (r.aging_bucket === '31-60') cust.d31_60 += r.balance;
      else if (r.aging_bucket === '61-90') cust.d61_90 += r.balance;
      else                                 cust.d91plus += r.balance;
    }

    const summary = Object.values(byCustomer).sort((a, b) => b.total - a.total);
    const grandTotal = summary.reduce((s, c) => s + c.total, 0);

    return ok({
      as_of: asOf,
      detail: mapped,
      summary,
      grand_total: parseFloat(grandTotal.toFixed(2)),
      duration_ms: Date.now() - t0,
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
