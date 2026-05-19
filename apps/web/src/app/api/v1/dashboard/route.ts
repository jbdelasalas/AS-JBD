export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const today = new Date().toISOString().split('T')[0];

  const [monthlySales, arAgingRows, apAgingRows, pendingInvoices, pendingBills] = await Promise.all([
    query(
      `SELECT to_char(invoice_date, 'YYYY-MM') AS month,
              COALESCE(SUM(total), 0)::numeric AS total,
              COUNT(*)::int AS count
         FROM sales_invoices
        WHERE company_id = $1
          AND status NOT IN ('draft','cancelled')
          AND invoice_date >= date_trunc('month', CURRENT_DATE) - interval '5 months'
        GROUP BY month ORDER BY month ASC`,
      [companyId],
    ),
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 0  AND 30  THEN balance ELSE 0 END), 0) AS current_amount,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 31 AND 60  THEN balance ELSE 0 END), 0) AS days_31_60,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 61 AND 90  THEN balance ELSE 0 END), 0) AS days_61_90,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 91 AND 120 THEN balance ELSE 0 END), 0) AS days_91_120,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) > 120               THEN balance ELSE 0 END), 0) AS over_120,
         COALESCE(SUM(balance), 0) AS total
         FROM sales_invoices
        WHERE company_id = $1 AND status IN ('open','partially_paid','overdue')`,
      [companyId, today],
    ),
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 0  AND 30  THEN balance ELSE 0 END), 0) AS current_amount,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 31 AND 60  THEN balance ELSE 0 END), 0) AS days_31_60,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 61 AND 90  THEN balance ELSE 0 END), 0) AS days_61_90,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 91 AND 120 THEN balance ELSE 0 END), 0) AS days_91_120,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) > 120               THEN balance ELSE 0 END), 0) AS over_120,
         COALESCE(SUM(balance), 0) AS total
         FROM bills
        WHERE company_id = $1 AND status IN ('approved','partially_paid')`,
      [companyId, today],
    ),
    query(
      `SELECT si.id, si.invoice_no, si.invoice_date, si.total, si.status,
              c.name AS customer_name
         FROM sales_invoices si
         JOIN customers c ON c.id = si.customer_id
        WHERE si.company_id = $1 AND si.status = 'draft'
        ORDER BY si.created_at DESC LIMIT 10`,
      [companyId],
    ),
    query(
      `SELECT b.id, b.internal_no, b.bill_date, b.total, b.status,
              s.name AS supplier_name
         FROM bills b
         JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.company_id = $1 AND b.status IN ('draft','pending_approval')
        ORDER BY b.created_at DESC LIMIT 10`,
      [companyId],
    ),
  ]);

  function aging(rows: unknown[]) {
    const r = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      current_amount: Number(r.current_amount ?? 0),
      days_31_60:     Number(r.days_31_60     ?? 0),
      days_61_90:     Number(r.days_61_90     ?? 0),
      days_91_120:    Number(r.days_91_120    ?? 0),
      over_120:       Number(r.over_120       ?? 0),
      total:          Number(r.total          ?? 0),
    };
  }

  return ok({
    monthly_sales: monthlySales.map((r) => {
      const row = r as Record<string, unknown>;
      return { month: String(row.month), total: Number(row.total), count: Number(row.count) };
    }),
    ar_aging: aging(arAgingRows),
    ap_aging: aging(apAgingRows),
    pending_invoices: pendingInvoices.map((r) => {
      const row = r as Record<string, unknown>;
      return { id: String(row.id), invoice_no: String(row.invoice_no),
               invoice_date: String(row.invoice_date), total: Number(row.total),
               customer_name: String(row.customer_name), status: String(row.status) };
    }),
    pending_bills: pendingBills.map((r) => {
      const row = r as Record<string, unknown>;
      return { id: String(row.id), internal_no: String(row.internal_no),
               bill_date: String(row.bill_date), total: Number(row.total),
               supplier_name: String(row.supplier_name), status: String(row.status) };
    }),
  });
}
