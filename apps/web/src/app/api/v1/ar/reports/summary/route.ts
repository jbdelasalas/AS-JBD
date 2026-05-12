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
  if (!companyId) return err('company_id is required', 400);

  const today = new Date().toISOString().split('T')[0];

  const openRows = await query<{
    total_open_ar: string;
    total_overdue: string;
    invoice_count_open: number;
  }>(
    `SELECT
       COALESCE(SUM(balance), 0) AS total_open_ar,
       COALESCE(SUM(CASE WHEN due_date < $2 THEN balance ELSE 0 END), 0) AS total_overdue,
       COUNT(CASE WHEN status IN ('open','partially_paid','overdue') THEN 1 END)::int AS invoice_count_open
       FROM sales_invoices
      WHERE company_id = $1 AND status IN ('open','partially_paid','overdue')`,
    [companyId, today],
  );

  const collectedRows = await query<{ total_collected_mtd: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total_collected_mtd
       FROM customer_payments
      WHERE company_id = $1
        AND status = 'posted'
        AND date_trunc('month', payment_date) = date_trunc('month', CURRENT_DATE)`,
    [companyId],
  );

  const customerRows = await query<{ customer_count_active: number }>(
    `SELECT COUNT(DISTINCT customer_id)::int AS customer_count_active
       FROM sales_invoices
      WHERE company_id = $1 AND status IN ('open','partially_paid','overdue')`,
    [companyId],
  );

  return ok({
    total_open_ar: Number(openRows[0].total_open_ar),
    total_overdue: Number(openRows[0].total_overdue),
    total_collected_mtd: Number(collectedRows[0].total_collected_mtd),
    invoice_count_open: openRows[0].invoice_count_open,
    customer_count_active: customerRows[0].customer_count_active,
  });
}
