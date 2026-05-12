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

  const asOf = searchParams.get('as_of_date') ?? new Date().toISOString().split('T')[0];

  const rows = await query(
    `SELECT
       c.id AS customer_id,
       c.code AS customer_code,
       c.name AS customer_name,
       COALESCE(SUM(CASE WHEN ($2::date - si.due_date) BETWEEN 0 AND 30  THEN si.balance ELSE 0 END), 0) AS current,
       COALESCE(SUM(CASE WHEN ($2::date - si.due_date) BETWEEN 31 AND 60 THEN si.balance ELSE 0 END), 0) AS days_31_60,
       COALESCE(SUM(CASE WHEN ($2::date - si.due_date) BETWEEN 61 AND 90 THEN si.balance ELSE 0 END), 0) AS days_61_90,
       COALESCE(SUM(CASE WHEN ($2::date - si.due_date) BETWEEN 91 AND 120 THEN si.balance ELSE 0 END), 0) AS days_91_120,
       COALESCE(SUM(CASE WHEN ($2::date - si.due_date) > 120               THEN si.balance ELSE 0 END), 0) AS over_120,
       COALESCE(SUM(si.balance), 0) AS total
       FROM customers c
       JOIN sales_invoices si ON si.customer_id = c.id
      WHERE c.company_id = $1
        AND si.status IN ('open','partially_paid','overdue')
        AND si.invoice_date <= $2
      GROUP BY c.id, c.code, c.name
     HAVING COALESCE(SUM(si.balance), 0) > 0
      ORDER BY total DESC`,
    [companyId, asOf],
  );

  return ok(rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      customer_id: row.customer_id as string,
      customer_code: row.customer_code as string,
      customer_name: row.customer_name as string,
      current: Number(row.current),
      days_31_60: Number(row.days_31_60),
      days_61_90: Number(row.days_61_90),
      days_91_120: Number(row.days_91_120),
      over_120: Number(row.over_120),
      total: Number(row.total),
    };
  }));
}
