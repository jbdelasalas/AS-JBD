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
       si.invoice_no, si.invoice_date,
       c.name AS customer_name, c.tin AS customer_tin,
       si.subtotal AS taxable_amount,
       si.vat_amount AS output_vat,
       si.total AS gross_amount,
       si.status
       FROM sales_invoices si
       JOIN customers c ON c.id = si.customer_id
      WHERE si.company_id = $1
        AND si.invoice_date BETWEEN $2 AND $3
        AND si.status NOT IN ('draft','cancelled')
        AND si.vat_amount > 0
      ORDER BY si.invoice_date ASC, si.invoice_no ASC`,
    [companyId, fromDate, toDate],
  );

  return ok(rows);
}
