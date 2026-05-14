-- 012_admin_seed.sql
-- bootstrap_company_defaults(): seeds Chart of Accounts, tax codes, UoMs,
-- payment methods, and document series for a newly created company.
-- Call this once after INSERT INTO companies.

CREATE OR REPLACE FUNCTION bootstrap_company_defaults(
  p_company_id  uuid,
  p_currency    varchar DEFAULT 'PHP'
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  -- Account IDs we'll need for cross-references
  v_cash_id       uuid := uuid_generate_v4();
  v_ar_id         uuid := uuid_generate_v4();
  v_inv_id        uuid := uuid_generate_v4();
  v_prepaid_id    uuid := uuid_generate_v4();
  v_ppe_id        uuid := uuid_generate_v4();
  v_accum_id      uuid := uuid_generate_v4();
  v_ap_id         uuid := uuid_generate_v4();
  v_vat_out_id    uuid := uuid_generate_v4();
  v_vat_in_id     uuid := uuid_generate_v4();
  v_ret_earn_id   uuid := uuid_generate_v4();
  v_sales_id      uuid := uuid_generate_v4();
  v_cogs_id       uuid := uuid_generate_v4();
  v_opex_id       uuid := uuid_generate_v4();
BEGIN

  -- ============================================================
  -- CHART OF ACCOUNTS (minimal Philippine GAAP-aligned CoA)
  -- ============================================================
  INSERT INTO accounts (id, company_id, code, name, type, normal_side, is_active) VALUES
    -- Assets
    (v_cash_id,     p_company_id, '1010', 'Cash and Cash Equivalents',        'ASSET',     'DR', true),
    (uuid_generate_v4(), p_company_id, '1020', 'Petty Cash Fund',             'ASSET',     'DR', true),
    (v_ar_id,       p_company_id, '1100', 'Accounts Receivable — Trade',      'ASSET',     'DR', true),
    (uuid_generate_v4(), p_company_id, '1110', 'Allowance for Doubtful Accounts','ASSET',  'CR', true),
    (v_inv_id,      p_company_id, '1200', 'Merchandise Inventory',            'ASSET',     'DR', true),
    (v_prepaid_id,  p_company_id, '1300', 'Prepaid Expenses',                 'ASSET',     'DR', true),
    (v_vat_in_id,   p_company_id, '1400', 'Input VAT',                        'ASSET',     'DR', true),
    (uuid_generate_v4(), p_company_id, '1500', 'Other Current Assets',        'ASSET',     'DR', true),
    (v_ppe_id,      p_company_id, '1600', 'Property, Plant & Equipment',      'ASSET',     'DR', true),
    (v_accum_id,    p_company_id, '1610', 'Accumulated Depreciation',         'ASSET',     'CR', true),
    -- Liabilities
    (v_ap_id,       p_company_id, '2010', 'Accounts Payable — Trade',         'LIABILITY', 'CR', true),
    (uuid_generate_v4(), p_company_id, '2020', 'Accrued Liabilities',         'LIABILITY', 'CR', true),
    (v_vat_out_id,  p_company_id, '2030', 'Output VAT',                       'LIABILITY', 'CR', true),
    (uuid_generate_v4(), p_company_id, '2040', 'Withholding Tax Payable',     'LIABILITY', 'CR', true),
    (uuid_generate_v4(), p_company_id, '2050', 'SSS / PhilHealth / HDMF Payable','LIABILITY','CR',true),
    (uuid_generate_v4(), p_company_id, '2100', 'Short-term Loans Payable',    'LIABILITY', 'CR', true),
    (uuid_generate_v4(), p_company_id, '2200', 'Long-term Loans Payable',     'LIABILITY', 'CR', true),
    -- Equity
    (uuid_generate_v4(), p_company_id, '3010', 'Share Capital',               'EQUITY',    'CR', true),
    (v_ret_earn_id, p_company_id, '3020', 'Retained Earnings',                'EQUITY',    'CR', true),
    (uuid_generate_v4(), p_company_id, '3030', 'Current Year Earnings',       'EQUITY',    'CR', true),
    -- Income
    (v_sales_id,    p_company_id, '4010', 'Sales Revenue',                    'INCOME',    'CR', true),
    (uuid_generate_v4(), p_company_id, '4020', 'Service Revenue',             'INCOME',    'CR', true),
    (uuid_generate_v4(), p_company_id, '4030', 'Other Income',                'INCOME',    'CR', true),
    -- Cost of Goods Sold
    (v_cogs_id,     p_company_id, '5010', 'Cost of Goods Sold',               'EXPENSE',   'DR', true),
    -- Operating Expenses
    (v_opex_id,     p_company_id, '6000', 'Operating Expenses',               'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6010', 'Salaries and Wages',          'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6020', 'Rent Expense',                'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6030', 'Utilities Expense',           'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6040', 'Depreciation Expense',        'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6050', 'Repairs and Maintenance',     'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6060', 'Advertising Expense',         'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6070', 'Professional Fees',           'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6080', 'Office Supplies Expense',     'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6090', 'Transportation Expense',      'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6100', 'Miscellaneous Expense',       'EXPENSE',   'DR', true),
    (uuid_generate_v4(), p_company_id, '6900', 'Income Tax Expense',          'EXPENSE',   'DR', true)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- ============================================================
  -- TAX CODES (Philippines — VAT + withholding)
  -- ============================================================
  INSERT INTO tax_codes (company_id, code, name, rate, tax_type, is_active) VALUES
    (p_company_id, 'VAT12',   'VAT 12%',                    12.00, 'OUTPUT', true),
    (p_company_id, 'VAT0',    'Zero-rated VAT',              0.00, 'OUTPUT', true),
    (p_company_id, 'EXEMPT',  'VAT Exempt',                  0.00, 'OUTPUT', true),
    (p_company_id, 'EWT1',    'EWT — Professional 10%',     10.00, 'WITHHOLDING', true),
    (p_company_id, 'EWT5',    'EWT — Broker/Agent 5%',       5.00, 'WITHHOLDING', true),
    (p_company_id, 'EWT2',    'EWT — Contractor 2%',         2.00, 'WITHHOLDING', true),
    (p_company_id, 'EWT1P',   'EWT — Supplier of Goods 1%',  1.00, 'WITHHOLDING', true)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- ============================================================
  -- UNITS OF MEASURE
  -- ============================================================
  INSERT INTO uoms (company_id, code, name, type, is_base) VALUES
    -- Count
    (p_company_id, 'PC',   'Piece',         'COUNT',  true),
    (p_company_id, 'BOX',  'Box',           'COUNT',  false),
    (p_company_id, 'CASE', 'Case',          'COUNT',  false),
    (p_company_id, 'DOZ',  'Dozen',         'COUNT',  false),
    (p_company_id, 'PACK', 'Pack',          'COUNT',  false),
    -- Weight
    (p_company_id, 'KG',   'Kilogram',      'WEIGHT', true),
    (p_company_id, 'G',    'Gram',          'WEIGHT', false),
    (p_company_id, 'LB',   'Pound',         'WEIGHT', false),
    -- Volume
    (p_company_id, 'L',    'Liter',         'VOLUME', true),
    (p_company_id, 'ML',   'Milliliter',    'VOLUME', false),
    (p_company_id, 'GAL',  'Gallon',        'VOLUME', false),
    -- Length
    (p_company_id, 'M',    'Meter',         'LENGTH', true),
    (p_company_id, 'CM',   'Centimeter',    'LENGTH', false),
    (p_company_id, 'FT',   'Foot',          'LENGTH', false),
    -- Time
    (p_company_id, 'HR',   'Hour',          'TIME',   true),
    (p_company_id, 'DAY',  'Day',           'TIME',   false),
    (p_company_id, 'MO',   'Month',         'TIME',   false)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- ============================================================
  -- PAYMENT METHODS
  -- ============================================================
  INSERT INTO payment_methods (company_id, code, name, account_id, requires_reference, is_active) VALUES
    (p_company_id, 'CASH',   'Cash',           v_cash_id, false, true),
    (p_company_id, 'CHECK',  'Check',          v_cash_id, true,  true),
    (p_company_id, 'BANK',   'Bank Transfer',  v_cash_id, true,  true),
    (p_company_id, 'GCASH',  'GCash',          v_cash_id, true,  true),
    (p_company_id, 'MAYA',   'Maya (PayMaya)', v_cash_id, true,  true),
    (p_company_id, 'CARD',   'Credit Card',    v_cash_id, true,  true)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- ============================================================
  -- DOCUMENT SERIES
  -- ============================================================
  INSERT INTO document_series (company_id, doc_type, prefix, last_no) VALUES
    (p_company_id, 'INV',   'INV-',  0),
    (p_company_id, 'SINV',  'SI-',   0),
    (p_company_id, 'CM',    'CM-',   0),
    (p_company_id, 'OR',    'OR-',   0),
    (p_company_id, 'PO',    'PO-',   0),
    (p_company_id, 'GRN',   'GRN-',  0),
    (p_company_id, 'BILL',  'BILL-', 0),
    (p_company_id, 'BP',    'BP-',   0),
    (p_company_id, 'SO',    'SO-',   0),
    (p_company_id, 'DR',    'DR-',   0),
    (p_company_id, 'JE',    'JE-',   0),
    (p_company_id, 'ADJ',   'ADJ-',  0),
    (p_company_id, 'XFER',  'TRF-',  0),
    (p_company_id, 'CNT',   'CNT-',  0)
  ON CONFLICT (company_id, doc_type) DO NOTHING;

END;
$$;
