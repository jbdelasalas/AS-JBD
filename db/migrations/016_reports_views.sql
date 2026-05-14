-- 016_reports_views.sql
-- Reusable views powering all reports. Single source of truth.
-- Adapted to actual schema: journal_entry_lines (entry_id), accounts (account_type),
-- sales_invoices, customer_payments, payment_applications, bills, bill_payment_applications.

-- 1. GL Detail — foundation for all financial reports
CREATE OR REPLACE VIEW v_gl_detail AS
SELECT
  je.id              AS entry_id,
  je.entry_no,
  je.entry_date,
  je.posted_at,
  je.voided_at,
  je.fiscal_period_id,
  je.source_module,
  je.source_doc_type,
  je.source_doc_id,
  je.company_id,
  jel.line_no,
  jel.account_id,
  a.code             AS account_code,
  a.name             AS account_name,
  a.account_type,
  at.is_balance_sheet,
  at.normal_side,
  jel.debit,
  jel.credit,
  jel.description    AS memo,
  je.branch_id
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.entry_id = je.id
JOIN accounts a ON a.id = jel.account_id
JOIN account_types at ON at.code = a.account_type
WHERE je.status = 'posted';

-- 2. Sales Register — issued OR/SI for VAT reconciliation
CREATE OR REPLACE VIEW v_sales_register AS
SELECT
  d.id,
  d.company_id,
  d.branch_id,
  d.document_type,
  d.document_no,
  d.transaction_date,
  d.customer_name,
  d.customer_tin,
  d.vatable_amount,
  d.vat_amount,
  d.vat_exempt_amount,
  d.zero_rated_amount,
  d.sc_discount,
  d.pwd_discount,
  d.total_amount,
  d.net_amount,
  d.status,
  d.voided_at
FROM issued_documents d
WHERE d.document_type IN ('OR', 'SI', 'CI');

-- 3. Purchase Register — AP bills
CREATE OR REPLACE VIEW v_purchase_register AS
SELECT
  b.id,
  b.company_id,
  b.branch_id,
  b.bill_no,
  b.internal_no,
  b.bill_date,
  s.name        AS supplier_name,
  s.tin         AS supplier_tin,
  b.subtotal    AS vatable_amount,
  b.vat_amount,
  b.total,
  b.amount_paid,
  b.balance,
  b.status
FROM bills b
JOIN suppliers s ON s.id = b.supplier_id;

-- 4. AR Open Balance — invoices with collections applied
CREATE OR REPLACE VIEW v_ar_open_balance AS
SELECT
  inv.id          AS invoice_id,
  inv.invoice_no,
  inv.invoice_date,
  inv.due_date,
  inv.customer_id,
  c.name          AS customer_name,
  inv.total       AS original_amount,
  COALESCE(SUM(pa.amount_applied), 0) AS paid_amount,
  inv.balance,
  inv.company_id,
  inv.branch_id,
  inv.status
FROM sales_invoices inv
LEFT JOIN payment_applications pa ON pa.invoice_id = inv.id
JOIN customers c ON c.id = inv.customer_id
WHERE inv.status NOT IN ('voided', 'draft')
GROUP BY inv.id, c.name;

-- 5. AP Open Balance — bills with payments applied
CREATE OR REPLACE VIEW v_ap_open_balance AS
SELECT
  b.id            AS bill_id,
  b.bill_no,
  b.internal_no,
  b.bill_date,
  b.due_date,
  b.supplier_id,
  s.name          AS supplier_name,
  b.total         AS original_amount,
  COALESCE(SUM(bpa.amount_applied), 0) AS paid_amount,
  b.balance,
  b.company_id,
  b.branch_id,
  b.status
FROM bills b
LEFT JOIN bill_payment_applications bpa ON bpa.bill_id = b.id
JOIN suppliers s ON s.id = b.supplier_id
WHERE b.status NOT IN ('void', 'draft')
GROUP BY b.id, s.name;

-- 6. Cash Movements — debit/credit on cash-type accounts (1000-series)
CREATE OR REPLACE VIEW v_cash_movements AS
SELECT
  je.company_id,
  je.branch_id,
  je.entry_date,
  je.source_doc_type,
  je.source_doc_id,
  jel.debit   AS cash_in,
  jel.credit  AS cash_out,
  a.code      AS account_code,
  a.name      AS account_name,
  je.posted_at
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.entry_id
JOIN accounts a ON a.id = jel.account_id
WHERE a.account_type IN ('cash', 'bank')
  AND je.status = 'posted';
