-- 014_bir_functions.sql
-- BIR computation functions: VAT 2550Q, books of accounts generation

-- Compute VAT Return 2550Q (quarterly)
-- Returns aggregated sales / purchases for the quarter from issued_documents and vat_relief_entries
CREATE OR REPLACE FUNCTION compute_vat_return_2550q(
  p_company_id  uuid,
  p_year        int,
  p_quarter     int
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_start_date  date;
  v_end_date    date;
  v_sales       json;
  v_purchases   json;
  v_output_vat  numeric(18,2);
  v_input_vat   numeric(18,2);
  v_vat_due     numeric(18,2);
BEGIN
  v_start_date := make_date(p_year, (p_quarter - 1) * 3 + 1, 1);
  v_end_date   := (v_start_date + interval '3 months - 1 day')::date;

  -- Aggregate sales from issued_documents
  SELECT json_build_object(
    'vatable',    COALESCE(SUM(vatable_amount), 0),
    'zero_rated', COALESCE(SUM(zero_rated_amount), 0),
    'exempt',     COALESCE(SUM(vat_exempt_amount), 0),
    'vat_output', COALESCE(SUM(vat_amount), 0),
    'gross_sales',COALESCE(SUM(total_amount), 0),
    'doc_count',  COUNT(*)
  )
  INTO v_sales
  FROM issued_documents
  WHERE company_id = p_company_id
    AND transaction_date BETWEEN v_start_date AND v_end_date
    AND status = 'active'
    AND document_type IN ('OR','SI','CI');

  -- Aggregate purchases from vat_relief_entries (purchases side)
  SELECT json_build_object(
    'vatable',    COALESCE(SUM(taxable_sales_vatable), 0),
    'zero_rated', COALESCE(SUM(taxable_sales_zero_rated), 0),
    'exempt',     COALESCE(SUM(taxable_sales_exempt), 0),
    'vat_input',  COALESCE(SUM(vat_amount), 0),
    'doc_count',  COUNT(*)
  )
  INTO v_purchases
  FROM vat_relief_entries
  WHERE company_id = p_company_id
    AND entry_type = 'purchases'
    AND entry_date BETWEEN v_start_date AND v_end_date;

  v_output_vat := (v_sales->>'vat_output')::numeric;
  v_input_vat  := (v_purchases->>'vat_input')::numeric;
  v_vat_due    := GREATEST(v_output_vat - v_input_vat, 0);

  RETURN json_build_object(
    'period_year',    p_year,
    'period_quarter', p_quarter,
    'start_date',     v_start_date,
    'end_date',       v_end_date,
    'sales',          v_sales,
    'purchases',      v_purchases,
    'output_vat',     v_output_vat,
    'input_vat',      v_input_vat,
    'vat_payable',    v_vat_due,
    'excess_input',   GREATEST(v_input_vat - v_output_vat, 0)
  );
END;
$$;

-- Generate Sales Book rows for a given month
-- Returns a dataset of sales transactions suitable for the Sales Book register
CREATE OR REPLACE FUNCTION generate_book_sales(
  p_company_id  uuid,
  p_year        int,
  p_month       int
) RETURNS TABLE (
  transaction_date  date,
  document_no       varchar,
  document_type     varchar,
  customer_name     varchar,
  customer_tin      varchar,
  gross_amount      numeric,
  exempt_amount     numeric,
  zero_rated_amount numeric,
  vatable_amount    numeric,
  vat_amount        numeric,
  net_amount        numeric
) LANGUAGE plpgsql AS $$
DECLARE
  v_start date := make_date(p_year, p_month, 1);
  v_end   date := (v_start + interval '1 month - 1 day')::date;
BEGIN
  RETURN QUERY
  SELECT
    id.transaction_date,
    id.document_no,
    id.document_type,
    id.customer_name,
    id.customer_tin,
    id.total_amount,
    id.vat_exempt_amount,
    id.zero_rated_amount,
    id.vatable_amount,
    id.vat_amount,
    id.net_amount
  FROM issued_documents id
  WHERE id.company_id = p_company_id
    AND id.transaction_date BETWEEN v_start AND v_end
    AND id.status = 'active'
    AND id.document_type IN ('OR','SI','CI','AR')
  ORDER BY id.transaction_date, id.document_no;
END;
$$;

-- Generate Purchase Book rows for a given month
-- Sources from vat_relief_entries (purchases) and bills
CREATE OR REPLACE FUNCTION generate_book_purchases(
  p_company_id  uuid,
  p_year        int,
  p_month       int
) RETURNS TABLE (
  entry_date        date,
  document_no       varchar,
  supplier_name     varchar,
  partner_tin       varchar,
  gross_amount      numeric,
  exempt_amount     numeric,
  zero_rated_amount numeric,
  vatable_amount    numeric,
  vat_amount        numeric,
  net_amount        numeric
) LANGUAGE plpgsql AS $$
DECLARE
  v_start date := make_date(p_year, p_month, 1);
  v_end   date := (v_start + interval '1 month - 1 day')::date;
BEGIN
  RETURN QUERY
  SELECT
    vre.entry_date,
    vre.document_no,
    vre.partner_name,
    vre.partner_tin,
    (vre.taxable_sales_vatable + vre.taxable_sales_zero_rated + vre.taxable_sales_exempt + vre.vat_amount) AS gross_amount,
    vre.taxable_sales_exempt,
    vre.taxable_sales_zero_rated,
    vre.taxable_sales_vatable,
    vre.vat_amount,
    (vre.taxable_sales_vatable + vre.taxable_sales_zero_rated + vre.taxable_sales_exempt) AS net_amount
  FROM vat_relief_entries vre
  WHERE vre.company_id = p_company_id
    AND vre.entry_type = 'purchases'
    AND vre.entry_date BETWEEN v_start AND v_end
  ORDER BY vre.entry_date, vre.document_no;
END;
$$;

-- Generate General Journal summary for a given month (from journal_entries / journal_lines)
CREATE OR REPLACE FUNCTION generate_book_general_journal(
  p_company_id  uuid,
  p_year        int,
  p_month       int
) RETURNS TABLE (
  entry_date    date,
  reference_no  varchar,
  description   text,
  account_code  varchar,
  account_name  varchar,
  debit         numeric,
  credit        numeric
) LANGUAGE plpgsql AS $$
DECLARE
  v_start date := make_date(p_year, p_month, 1);
  v_end   date := (v_start + interval '1 month - 1 day')::date;
BEGIN
  RETURN QUERY
  SELECT
    je.entry_date,
    je.reference_no,
    je.description,
    a.code   AS account_code,
    a.name   AS account_name,
    jl.debit,
    jl.credit
  FROM journal_entries je
  JOIN journal_lines jl ON jl.journal_id = je.id
  JOIN accounts a ON a.id = jl.account_id
  WHERE je.company_id = p_company_id
    AND je.entry_date BETWEEN v_start AND v_end
    AND je.status = 'posted'
  ORDER BY je.entry_date, je.reference_no, jl.line_no;
END;
$$;

-- Compute EWT summary for 1601-EQ (quarterly EWT return)
CREATE OR REPLACE FUNCTION compute_ewt_return_1601eq(
  p_company_id  uuid,
  p_year        int,
  p_quarter     int
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_start_date  date;
  v_end_date    date;
  v_result      json;
BEGIN
  v_start_date := make_date(p_year, (p_quarter - 1) * 3 + 1, 1);
  v_end_date   := (v_start_date + interval '3 months - 1 day')::date;

  SELECT json_agg(row_to_json(s)) INTO v_result
  FROM (
    SELECT
      tc.bir_atc_code,
      tc.name AS tax_name,
      tc.rate_pct,
      COUNT(wc.id) AS cert_count,
      COALESCE(SUM(wc.taxable_amount), 0) AS total_taxable,
      COALESCE(SUM(wc.amount_withheld), 0) AS total_withheld
    FROM wht_certificates wc
    JOIN tax_codes tc ON tc.bir_atc_code = wc.bir_atc_code AND tc.company_id = wc.company_id
    WHERE wc.company_id = p_company_id
      AND wc.period_year = p_year
      AND wc.period_quarter = p_quarter
    GROUP BY tc.bir_atc_code, tc.name, tc.rate_pct
    ORDER BY tc.bir_atc_code
  ) s;

  RETURN json_build_object(
    'period_year',    p_year,
    'period_quarter', p_quarter,
    'start_date',     v_start_date,
    'end_date',       v_end_date,
    'breakdown',      COALESCE(v_result, '[]'::json),
    'total_withheld', (
      SELECT COALESCE(SUM(amount_withheld), 0)
      FROM wht_certificates
      WHERE company_id = p_company_id
        AND period_year = p_year
        AND period_quarter = p_quarter
    )
  );
END;
$$;
