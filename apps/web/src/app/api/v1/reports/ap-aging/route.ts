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
  const supplierId = searchParams.get('supplier_id') ?? null;

  try {
    const t0 = Date.now();
    const rows = await query<{
      supplier_id: string; supplier_name: string; bill_id: string;
      bill_no: string; bill_date: string; due_date: string;
      original: string; paid: string; balance: string;
      days_overdue: number; aging_bucket: string;
    }>(
      `SELECT * FROM ap_aging($1, $2::date, $3::uuid)`,
      [companyId, asOf, supplierId],
    );

    const mapped = rows.map((r) => ({
      ...r,
      original: Number(r.original),
      paid: Number(r.paid),
      balance: Number(r.balance),
      days_overdue: Number(r.days_overdue),
    }));

    const bySupplier: Record<string, {
      supplier_id: string; supplier_name: string;
      current: number; d1_30: number; d31_60: number; d61_90: number; d91plus: number; total: number;
    }> = {};
    for (const r of mapped) {
      if (!bySupplier[r.supplier_id]) {
        bySupplier[r.supplier_id] = {
          supplier_id: r.supplier_id, supplier_name: r.supplier_name,
          current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91plus: 0, total: 0,
        };
      }
      const sup = bySupplier[r.supplier_id];
      sup.total += r.balance;
      if (r.aging_bucket === 'current') sup.current += r.balance;
      else if (r.aging_bucket === '1-30')  sup.d1_30 += r.balance;
      else if (r.aging_bucket === '31-60') sup.d31_60 += r.balance;
      else if (r.aging_bucket === '61-90') sup.d61_90 += r.balance;
      else                                 sup.d91plus += r.balance;
    }

    const summary = Object.values(bySupplier).sort((a, b) => b.total - a.total);
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
