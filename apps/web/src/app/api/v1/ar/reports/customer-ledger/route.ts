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
  const customerId = searchParams.get('customer_id');
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');

  if (!companyId) return err('company_id is required', 400);
  if (!customerId) return err('customer_id is required', 400);
  if (!fromDate || !toDate) return err('from_date and to_date are required', 400);

  const rows = await query(
    `SELECT
       'invoice' AS txn_type,
       si.invoice_no AS doc_no,
       si.invoice_date AS txn_date,
       si.due_date,
       si.total AS debit,
       0 AS credit,
       si.balance AS running_balance,
       si.status
       FROM sales_invoices si
      WHERE si.company_id = $1
        AND si.customer_id = $2
        AND si.invoice_date BETWEEN $3 AND $4
        AND si.status != 'cancelled'
     UNION ALL
     SELECT
       'payment' AS txn_type,
       cp.receipt_no AS doc_no,
       cp.payment_date AS txn_date,
       NULL AS due_date,
       0 AS debit,
       cp.amount AS credit,
       0 AS running_balance,
       cp.status
       FROM customer_payments cp
      WHERE cp.company_id = $1
        AND cp.customer_id = $2
        AND cp.payment_date BETWEEN $3 AND $4
        AND cp.status != 'cancelled'
     UNION ALL
     SELECT
       'credit_memo' AS txn_type,
       cm.cm_no AS doc_no,
       cm.cm_date AS txn_date,
       NULL AS due_date,
       0 AS debit,
       cm.total AS credit,
       0 AS running_balance,
       cm.status
       FROM ar_credit_memos cm
      WHERE cm.company_id = $1
        AND cm.customer_id = $2
        AND cm.cm_date BETWEEN $3 AND $4
        AND cm.status NOT IN ('draft','cancelled')
      ORDER BY txn_date ASC, doc_no ASC`,
    [companyId, customerId, fromDate, toDate],
  );

  return ok(rows);
}
