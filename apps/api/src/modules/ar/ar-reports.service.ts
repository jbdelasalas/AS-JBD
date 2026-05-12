import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AgingBucket, ARSummary } from '@perpet/shared';

@Injectable()
export class ARReportsService {
  constructor(private readonly ds: DataSource) {}

  async getSummary(companyId: string): Promise<ARSummary> {
    const today = new Date().toISOString().split('T')[0];

    const openRows = await this.ds.query(
      `SELECT
         COALESCE(SUM(balance), 0) AS total_open_ar,
         COALESCE(SUM(CASE WHEN due_date < $2 THEN balance ELSE 0 END), 0) AS total_overdue,
         COUNT(CASE WHEN status IN ('open','partially_paid','overdue') THEN 1 END)::int AS invoice_count_open
         FROM sales_invoices
        WHERE company_id = $1 AND status IN ('open','partially_paid','overdue')`,
      [companyId, today],
    );

    const collectedRows = await this.ds.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_collected_mtd
         FROM customer_payments
        WHERE company_id = $1
          AND status = 'posted'
          AND date_trunc('month', payment_date) = date_trunc('month', CURRENT_DATE)`,
      [companyId],
    );

    const customerRows = await this.ds.query(
      `SELECT COUNT(DISTINCT customer_id)::int AS customer_count_active
         FROM sales_invoices
        WHERE company_id = $1 AND status IN ('open','partially_paid','overdue')`,
      [companyId],
    );

    return {
      total_open_ar: Number(openRows[0].total_open_ar),
      total_overdue: Number(openRows[0].total_overdue),
      total_collected_mtd: Number(collectedRows[0].total_collected_mtd),
      invoice_count_open: openRows[0].invoice_count_open,
      customer_count_active: customerRows[0].customer_count_active,
    };
  }

  async getAgingReport(companyId: string, asOfDate?: string): Promise<AgingBucket[]> {
    const asOf = asOfDate ?? new Date().toISOString().split('T')[0];

    const rows = await this.ds.query(
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

    return rows.map((r: Record<string, unknown>) => ({
      customer_id: r.customer_id as string,
      customer_code: r.customer_code as string,
      customer_name: r.customer_name as string,
      current: Number(r.current),
      days_31_60: Number(r.days_31_60),
      days_61_90: Number(r.days_61_90),
      days_91_120: Number(r.days_91_120),
      over_120: Number(r.over_120),
      total: Number(r.total),
    }));
  }

  async getSalesRegister(companyId: string, fromDate: string, toDate: string) {
    return this.ds.query(
      `SELECT si.invoice_no, si.invoice_date, si.due_date, si.status,
              c.code AS customer_code, c.name AS customer_name,
              si.subtotal, si.vat_amount, si.total, si.amount_paid, si.balance,
              so.order_no
         FROM sales_invoices si
         JOIN customers c ON c.id = si.customer_id
         LEFT JOIN sales_orders so ON so.id = si.so_id
        WHERE si.company_id = $1
          AND si.invoice_date BETWEEN $2 AND $3
          AND si.status != 'cancelled'
        ORDER BY si.invoice_date ASC, si.invoice_no ASC`,
      [companyId, fromDate, toDate],
    );
  }

  async getVATReport(companyId: string, fromDate: string, toDate: string) {
    return this.ds.query(
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
  }

  async getCollectionReport(companyId: string, fromDate: string, toDate: string) {
    return this.ds.query(
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
  }

  async getCustomerLedger(companyId: string, customerId: string, fromDate: string, toDate: string) {
    const invoices = await this.ds.query(
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

    return invoices;
  }
}
