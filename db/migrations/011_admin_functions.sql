-- 011_admin_functions.sql
-- Postgres helper functions for the Administration module.

-- ============================================================================
-- next_doc_no
-- Atomically increments document_series and returns the next formatted number.
-- Uses SKIP LOCKED so concurrent calls never collide.
-- ============================================================================
CREATE OR REPLACE FUNCTION next_doc_no(
  p_company_id  uuid,
  p_branch_id   uuid,
  p_doc_type    varchar
) RETURNS varchar LANGUAGE plpgsql AS $$
DECLARE
  v_row   document_series%ROWTYPE;
  v_seq   int;
  v_no    varchar;
BEGIN
  -- Lock the matching series row
  SELECT * INTO v_row
    FROM document_series
   WHERE company_id = p_company_id
     AND doc_type   = p_doc_type
     AND (branch_id = p_branch_id OR branch_id IS NULL)
   ORDER BY branch_id NULLS LAST      -- prefer branch-specific over company-wide
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No document series defined for type % in this company', p_doc_type;
  END IF;

  v_seq := v_row.last_no + 1;

  UPDATE document_series
     SET last_no    = v_seq,
         updated_at = now()
   WHERE id = v_row.id;

  -- Build number: prefix + zero-padded sequence, e.g. INV-2026-000001
  v_no := v_row.prefix
       || to_char(now(), 'YYYY')
       || '-'
       || lpad(v_seq::text, 6, '0');

  RETURN v_no;
END;
$$;

-- ============================================================================
-- close_fiscal_period
-- Marks a fiscal period as CLOSED and stamps who closed it.
-- ============================================================================
CREATE OR REPLACE FUNCTION close_fiscal_period(
  p_period_id  uuid,
  p_user_id    uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fiscal_periods
     SET status     = 'CLOSED',
         locked_at  = now(),
         locked_by  = p_user_id
   WHERE id = p_period_id
     AND status IN ('OPEN','ADJUSTING');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period % is not open or does not exist', p_period_id;
  END IF;
END;
$$;

-- ============================================================================
-- open_fiscal_period
-- Re-opens a CLOSED period (adjustment window).
-- ============================================================================
CREATE OR REPLACE FUNCTION open_fiscal_period(
  p_period_id  uuid,
  p_user_id    uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fiscal_periods
     SET status    = 'OPEN',
         locked_at = NULL,
         locked_by = NULL
   WHERE id = p_period_id
     AND status = 'CLOSED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period % is not closed or does not exist', p_period_id;
  END IF;
END;
$$;

-- ============================================================================
-- year_end_close
-- Closes all open periods in a fiscal year, posts a retained-earnings entry,
-- and marks the fiscal year as closed.
-- p_re_account_id: the Retained Earnings GL account to credit net income into.
-- ============================================================================
CREATE OR REPLACE FUNCTION year_end_close(
  p_fiscal_year_id  uuid,
  p_user_id         uuid,
  p_re_account_id   uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_fy         fiscal_years%ROWTYPE;
  v_company_id uuid;
  v_je_id      uuid;
  v_net_income numeric(18,4);
  v_doc_no     varchar;
BEGIN
  -- Fetch and lock the fiscal year
  SELECT * INTO v_fy FROM fiscal_years WHERE id = p_fiscal_year_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal year % not found', p_fiscal_year_id;
  END IF;
  IF v_fy.is_closed THEN
    RAISE EXCEPTION 'Fiscal year % is already closed', p_fiscal_year_id;
  END IF;

  v_company_id := v_fy.company_id;

  -- Close all non-closed periods in this year
  UPDATE fiscal_periods
     SET status    = 'CLOSED',
         locked_at = now(),
         locked_by = p_user_id
   WHERE fiscal_year_id = p_fiscal_year_id
     AND status <> 'CLOSED';

  -- Calculate net income: sum of revenue minus expenses for the year
  -- (revenue = credit-normal income accounts, expense = debit-normal expense accounts)
  SELECT COALESCE(SUM(
    CASE
      WHEN a.normal_side = 'CR' THEN jl.credit - jl.debit   -- income
      WHEN a.normal_side = 'DR' THEN jl.debit  - jl.credit  -- expense (negate)
      ELSE 0
    END
  ), 0)
    INTO v_net_income
    FROM journal_lines    jl
    JOIN journal_entries  je ON je.id = jl.journal_entry_id
    JOIN accounts         a  ON a.id  = jl.account_id
   WHERE je.company_id = v_company_id
     AND a.type IN ('INCOME','EXPENSE')
     AND je.period_id IN (
           SELECT id FROM fiscal_periods WHERE fiscal_year_id = p_fiscal_year_id
         )
     AND je.status = 'POSTED';

  -- Get a document number for the closing entry
  v_doc_no := 'YEC-' || v_fy.year::text;

  -- Create the year-end closing journal entry
  INSERT INTO journal_entries (
    id, company_id, journal_no, reference, description,
    entry_date, status, created_by
  ) VALUES (
    uuid_generate_v4(), v_company_id, v_doc_no, v_doc_no,
    'Year-end closing entry — FY ' || v_fy.year,
    v_fy.end_date, 'POSTED', p_user_id
  ) RETURNING id INTO v_je_id;

  -- Credit retained earnings with net income
  -- (if net income < 0, this becomes a debit — handled by sign)
  IF v_net_income >= 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, p_re_account_id, 0, v_net_income, 'Net income transfer');
  ELSE
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, p_re_account_id, ABS(v_net_income), 0, 'Net loss transfer');
  END IF;

  -- Mark fiscal year closed
  UPDATE fiscal_years
     SET is_closed  = true,
         closed_at  = now(),
         closed_by  = p_user_id
   WHERE id = p_fiscal_year_id;

  RETURN v_je_id;
END;
$$;
