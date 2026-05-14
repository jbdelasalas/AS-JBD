-- 017_reports_functions.sql
-- Core report computation functions used by the Next.js API routes.

-- Trial Balance: debit/credit sums per account as of a timestamp
CREATE OR REPLACE FUNCTION trial_balance(
  p_company_id  uuid,
  p_as_of       timestamptz,
  p_branch_id   uuid DEFAULT NULL
) RETURNS TABLE (
  account_code    text,
  account_name    text,
  account_type    text,
  is_balance_sheet boolean,
  normal_side     text,
  period_debit    numeric(18,4),
  period_credit   numeric(18,4),
  ending_balance  numeric(18,4)
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  WITH filtered_gl AS (
    SELECT g.*
    FROM v_gl_detail g
    WHERE g.company_id = p_company_id
      AND g.posted_at <= p_as_of
      AND (g.voided_at IS NULL OR g.voided_at > p_as_of)
      AND (p_branch_id IS NULL OR g.branch_id = p_branch_id)
  )
  SELECT
    a.code,
    a.name,
    a.account_type,
    at.is_balance_sheet,
    at.normal_side,
    COALESCE(SUM(f.debit), 0)::numeric(18,4)   AS period_debit,
    COALESCE(SUM(f.credit), 0)::numeric(18,4)  AS period_credit,
    (COALESCE(SUM(f.debit), 0) - COALESCE(SUM(f.credit), 0))::numeric(18,4) AS ending_balance
  FROM accounts a
  JOIN account_types at ON at.code = a.account_type
  LEFT JOIN filtered_gl f ON f.account_id = a.id
  WHERE a.company_id = p_company_id
    AND a.is_active = true
  GROUP BY a.id, a.code, a.name, a.account_type, at.is_balance_sheet, at.normal_side
  ORDER BY a.code;
END;
$$;

-- Income Statement: revenue and expense accounts for a date range
CREATE OR REPLACE FUNCTION income_statement(
  p_company_id  uuid,
  p_start_date  date,
  p_end_date    date,
  p_branch_id   uuid DEFAULT NULL
) RETURNS TABLE (
  account_type  text,
  account_code  text,
  account_name  text,
  normal_side   text,
  period_debit  numeric(18,4),
  period_credit numeric(18,4),
  net_amount    numeric(18,4)
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  WITH period_gl AS (
    SELECT g.*
    FROM v_gl_detail g
    WHERE g.company_id = p_company_id
      AND g.entry_date BETWEEN p_start_date AND p_end_date
      AND g.voided_at IS NULL
      AND (p_branch_id IS NULL OR g.branch_id = p_branch_id)
  )
  SELECT
    a.account_type,
    a.code,
    a.name,
    at.normal_side,
    COALESCE(SUM(p.debit), 0)::numeric(18,4)   AS period_debit,
    COALESCE(SUM(p.credit), 0)::numeric(18,4)  AS period_credit,
    -- For revenue (normal_side=credit): net = credit - debit (positive = earned)
    -- For expense (normal_side=debit): net = debit - credit (positive = spent)
    CASE WHEN at.normal_side = 'credit'
      THEN (COALESCE(SUM(p.credit), 0) - COALESCE(SUM(p.debit), 0))
      ELSE (COALESCE(SUM(p.debit), 0) - COALESCE(SUM(p.credit), 0))
    END::numeric(18,4) AS net_amount
  FROM accounts a
  JOIN account_types at ON at.code = a.account_type
  LEFT JOIN period_gl p ON p.account_id = a.id
  WHERE a.company_id = p_company_id
    AND a.is_active = true
    AND at.is_balance_sheet = false  -- income statement accounts only
  GROUP BY a.id, a.account_type, a.code, a.name, at.normal_side
  HAVING COALESCE(SUM(p.debit), 0) + COALESCE(SUM(p.credit), 0) > 0
  ORDER BY a.account_type, a.code;
END;
$$;

-- AR Aging: buckets by days past due as of a date
CREATE OR REPLACE FUNCTION ar_aging(
  p_company_id  uuid,
  p_as_of       date DEFAULT CURRENT_DATE,
  p_customer_id uuid DEFAULT NULL
) RETURNS TABLE (
  customer_id   uuid,
  customer_name text,
  invoice_id    uuid,
  invoice_no    text,
  invoice_date  date,
  due_date      date,
  original      numeric(18,2),
  paid          numeric(18,2),
  balance       numeric(18,2),
  days_overdue  int,
  aging_bucket  text
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    ar.customer_id,
    ar.customer_name,
    ar.invoice_id,
    ar.invoice_no,
    ar.invoice_date::date,
    ar.due_date::date,
    ar.original_amount,
    ar.paid_amount,
    ar.balance,
    GREATEST((p_as_of - ar.due_date::date)::int, 0) AS days_overdue,
    CASE
      WHEN ar.balance <= 0                                          THEN 'current'
      WHEN (p_as_of - ar.due_date::date) <= 0                      THEN 'current'
      WHEN (p_as_of - ar.due_date::date) BETWEEN 1  AND 30         THEN '1-30'
      WHEN (p_as_of - ar.due_date::date) BETWEEN 31 AND 60         THEN '31-60'
      WHEN (p_as_of - ar.due_date::date) BETWEEN 61 AND 90         THEN '61-90'
      ELSE '91+'
    END AS aging_bucket
  FROM v_ar_open_balance ar
  WHERE ar.company_id = p_company_id
    AND ar.balance > 0
    AND (p_customer_id IS NULL OR ar.customer_id = p_customer_id)
  ORDER BY ar.customer_name, ar.due_date;
END;
$$;

-- AP Aging: mirror of AR aging for supplier bills
CREATE OR REPLACE FUNCTION ap_aging(
  p_company_id  uuid,
  p_as_of       date DEFAULT CURRENT_DATE,
  p_supplier_id uuid DEFAULT NULL
) RETURNS TABLE (
  supplier_id   uuid,
  supplier_name text,
  bill_id       uuid,
  bill_no       text,
  bill_date     date,
  due_date      date,
  original      numeric(18,2),
  paid          numeric(18,2),
  balance       numeric(18,2),
  days_overdue  int,
  aging_bucket  text
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    ap.supplier_id,
    ap.supplier_name,
    ap.bill_id,
    ap.bill_no,
    ap.bill_date::date,
    ap.due_date::date,
    ap.original_amount,
    ap.paid_amount,
    ap.balance,
    GREATEST((p_as_of - ap.due_date::date)::int, 0) AS days_overdue,
    CASE
      WHEN ap.balance <= 0                                          THEN 'current'
      WHEN (p_as_of - ap.due_date::date) <= 0                      THEN 'current'
      WHEN (p_as_of - ap.due_date::date) BETWEEN 1  AND 30         THEN '1-30'
      WHEN (p_as_of - ap.due_date::date) BETWEEN 31 AND 60         THEN '31-60'
      WHEN (p_as_of - ap.due_date::date) BETWEEN 61 AND 90         THEN '61-90'
      ELSE '91+'
    END AS aging_bucket
  FROM v_ap_open_balance ap
  WHERE ap.company_id = p_company_id
    AND ap.balance > 0
    AND (p_supplier_id IS NULL OR ap.supplier_id = p_supplier_id)
  ORDER BY ap.supplier_name, ap.due_date;
END;
$$;

-- Sales Summary: daily/monthly aggregates from v_sales_register
CREATE OR REPLACE FUNCTION sales_summary(
  p_company_id  uuid,
  p_start_date  date,
  p_end_date    date,
  p_group_by    text DEFAULT 'day'  -- 'day' | 'month'
) RETURNS TABLE (
  period        text,
  doc_count     bigint,
  vatable       numeric(18,2),
  vat_amount    numeric(18,2),
  exempt        numeric(18,2),
  zero_rated    numeric(18,2),
  gross_sales   numeric(18,2),
  net_sales     numeric(18,2)
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE p_group_by
      WHEN 'month' THEN to_char(s.transaction_date, 'YYYY-MM')
      ELSE s.transaction_date::text
    END AS period,
    COUNT(*),
    COALESCE(SUM(s.vatable_amount), 0)::numeric(18,2),
    COALESCE(SUM(s.vat_amount), 0)::numeric(18,2),
    COALESCE(SUM(s.vat_exempt_amount), 0)::numeric(18,2),
    COALESCE(SUM(s.zero_rated_amount), 0)::numeric(18,2),
    COALESCE(SUM(s.total_amount), 0)::numeric(18,2),
    COALESCE(SUM(s.net_amount), 0)::numeric(18,2)
  FROM v_sales_register s
  WHERE s.company_id = p_company_id
    AND s.transaction_date BETWEEN p_start_date AND p_end_date
    AND s.status = 'active'
  GROUP BY 1
  ORDER BY 1;
END;
$$;
