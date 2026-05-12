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
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');

  if (!companyId) return err('company_id is required', 400);
  if (!fromDate || !toDate) return err('from_date and to_date are required', 400);

  const rows = await query(
    `SELECT
       cp.receipt_no, cp.payment_date, cp.payment_method,
       c.code AS customer_code, c.name AS customer_name,
       cp.amount, cp.unapplied_amount, cp.status, cp.reference,
       COALESCE(
         json_agg(json_build_object(
           'invoice_no', si.invoice_no,
           'amount_applied', pa.amount_applied
         )) FILTER (WHERE pa.id IS NOT NULL),
         '[]'
       ) AS applications
       FROM customer_payments cp
       JOIN customers c ON c.id = cp.customer_id
       LEFT JOIN payment_applications pa ON pa.payment_id = cp.id
       LEFT JOIN sales_invoices si ON si.id = pa.invoice_id
      WHERE cp.company_id = $1
        AND cp.payment_date BETWEEN $2 AND $3
        AND cp.status != 'cancelled'
      GROUP BY cp.id, c.code, c.name
      ORDER BY cp.payment_date ASC, cp.receipt_no ASC`,
    [companyId, fromDate, toDate],
  );

  return ok(rows);
}
