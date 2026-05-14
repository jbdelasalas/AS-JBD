-- 013_bir_extended.sql
-- BIR Compliance Module Extended Tables
-- Adds issued documents, books of accounts, SC/PWD, excise, and validation tables.
-- References RR 11-2024, RR 16-2005, RR 9-2009, RMC 29-2019, RA 9994 (SC), RA 10754 (PWD), NIRC Sec. 148 TRAIN

-- Issued documents (Official Receipts / Sales Invoices per BIR requirements)
CREATE TABLE IF NOT EXISTS issued_documents (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id           uuid REFERENCES branches(id),
  document_type       varchar(10) NOT NULL, -- OR | SI | AR | DR | CI | CR
  series_id           uuid REFERENCES document_series(id),
  document_no         varchar(50) NOT NULL,
  transaction_date    date NOT NULL,
  customer_id         uuid REFERENCES customers(id),
  customer_tin        varchar(20),
  customer_name       varchar(200) NOT NULL,
  customer_address    text,
  is_vat_registered   boolean NOT NULL DEFAULT false,
  sc_pwd_id           varchar(30),           -- OSCA/PWD ID number if applicable
  total_amount        numeric(18,2) NOT NULL DEFAULT 0,
  vatable_amount      numeric(18,2) NOT NULL DEFAULT 0,
  vat_exempt_amount   numeric(18,2) NOT NULL DEFAULT 0,
  zero_rated_amount   numeric(18,2) NOT NULL DEFAULT 0,
  vat_amount          numeric(18,2) NOT NULL DEFAULT 0,
  sc_discount         numeric(18,2) NOT NULL DEFAULT 0,
  pwd_discount        numeric(18,2) NOT NULL DEFAULT 0,
  total_discount      numeric(18,2) NOT NULL DEFAULT 0,
  net_amount          numeric(18,2) NOT NULL DEFAULT 0,
  status              varchar(20) NOT NULL DEFAULT 'active', -- active | void | cancelled
  void_reason         text,
  voided_at           timestamptz,
  voided_by           uuid REFERENCES users(id),
  ar_invoice_id       uuid REFERENCES customers(id), -- link to AR invoice if created from AR
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, document_no)
);
CREATE INDEX idx_issued_documents_company_date ON issued_documents (company_id, transaction_date);
CREATE INDEX idx_issued_documents_type ON issued_documents (company_id, document_type);
CREATE INDEX idx_issued_documents_status ON issued_documents (company_id, status);
CREATE TRIGGER issued_documents_updated BEFORE UPDATE ON issued_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prevent modification of active issued documents (immutability per BIR rules)
CREATE OR REPLACE FUNCTION prevent_issued_document_modification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'active' THEN
    IF OLD.document_no <> NEW.document_no
    OR OLD.transaction_date <> NEW.transaction_date
    OR OLD.total_amount <> NEW.total_amount
    OR OLD.net_amount <> NEW.net_amount THEN
      RAISE EXCEPTION 'Active BIR-issued documents cannot be modified. Void and reissue instead.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER issued_documents_immutable
  BEFORE UPDATE ON issued_documents
  FOR EACH ROW EXECUTE FUNCTION prevent_issued_document_modification();

-- Issued document line items
CREATE TABLE IF NOT EXISTS issued_document_lines (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id         uuid NOT NULL REFERENCES issued_documents(id) ON DELETE CASCADE,
  line_no             int NOT NULL,
  description         text NOT NULL,
  quantity            numeric(18,4) NOT NULL DEFAULT 1,
  unit_price          numeric(18,4) NOT NULL DEFAULT 0,
  discount_amount     numeric(18,2) NOT NULL DEFAULT 0,
  vatable_amount      numeric(18,2) NOT NULL DEFAULT 0,
  vat_exempt_amount   numeric(18,2) NOT NULL DEFAULT 0,
  zero_rated_amount   numeric(18,2) NOT NULL DEFAULT 0,
  vat_amount          numeric(18,2) NOT NULL DEFAULT 0,
  line_total          numeric(18,2) NOT NULL DEFAULT 0,
  item_id             uuid REFERENCES items(id),
  tax_code_id         uuid REFERENCES tax_codes(id)
);
CREATE INDEX idx_issued_doc_lines_document ON issued_document_lines (document_id);

-- SC/PWD transaction records (RA 9994 / RA 10754)
CREATE TABLE IF NOT EXISTS sc_pwd_transactions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id           uuid REFERENCES branches(id),
  document_id         uuid NOT NULL REFERENCES issued_documents(id),
  sc_pwd_type         varchar(10) NOT NULL, -- SC | PWD
  id_number           varchar(50) NOT NULL,
  beneficiary_name    varchar(200) NOT NULL,
  osca_number         varchar(50),
  gross_amount        numeric(18,2) NOT NULL,
  discount_rate       numeric(6,4) NOT NULL DEFAULT 0.20,
  discount_amount     numeric(18,2) NOT NULL,
  vat_exemption_amount numeric(18,2) NOT NULL DEFAULT 0,
  net_amount          numeric(18,2) NOT NULL,
  transaction_date    date NOT NULL,
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sc_pwd_company_date ON sc_pwd_transactions (company_id, transaction_date);

-- Books of accounts generation records (Sales Book, Purchase Book, General Journal, Cash Voucher Book)
CREATE TABLE IF NOT EXISTS book_generations (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id           uuid REFERENCES branches(id),
  book_type           varchar(10) NOT NULL, -- SB | PB | GJ | CVB | CRB | CDB
  period_year         int NOT NULL,
  period_month        int CHECK (period_month BETWEEN 1 AND 12),
  period_quarter      int CHECK (period_quarter BETWEEN 1 AND 4),
  row_count           int NOT NULL DEFAULT 0,
  total_amount        numeric(18,2) NOT NULL DEFAULT 0,
  status              varchar(20) NOT NULL DEFAULT 'draft', -- draft | final
  storage_path        text,                 -- file path stub for future PDF export
  generated_by        uuid NOT NULL REFERENCES users(id),
  generated_at        timestamptz NOT NULL DEFAULT now(),
  finalized_at        timestamptz,
  finalized_by        uuid REFERENCES users(id)
);
CREATE INDEX idx_book_generations_company_period ON book_generations (company_id, period_year, period_month);
CREATE UNIQUE INDEX idx_book_gen_unique ON book_generations (company_id, book_type, period_year, COALESCE(period_month, 0));

-- Filing validations (warnings / errors before marking filed)
CREATE TABLE IF NOT EXISTS filing_validations (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  filing_id           uuid NOT NULL REFERENCES bir_filings(id) ON DELETE CASCADE,
  validation_type     varchar(10) NOT NULL, -- error | warning | info
  field_name          varchar(100),
  message             text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_filing_validations_filing ON filing_validations (filing_id);

-- Excise tax rates (NIRC Sec. 148 as amended by TRAIN)
CREATE TABLE IF NOT EXISTS excise_rates (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_type        varchar(50) NOT NULL,  -- diesel | gasoline | jet_fuel | bunker | kerosene | lpg | other
  description         varchar(200) NOT NULL,
  rate_per_unit       numeric(10,4) NOT NULL,
  unit_of_measure     varchar(20) NOT NULL DEFAULT 'liter',
  effective_date      date NOT NULL,
  end_date            date,
  bir_classification  varchar(50),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_excise_rates_company ON excise_rates (company_id, product_type, effective_date);

-- Excise pass-through on issued documents
CREATE TABLE IF NOT EXISTS excise_pass_through (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id         uuid NOT NULL REFERENCES issued_documents(id) ON DELETE CASCADE,
  excise_rate_id      uuid NOT NULL REFERENCES excise_rates(id),
  quantity            numeric(18,4) NOT NULL,
  rate_per_unit       numeric(10,4) NOT NULL,
  amount              numeric(18,2) NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_excise_pass_through_doc ON excise_pass_through (document_id);

-- Add bir_tin column to companies if not already present (needed for BIR forms)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bir_tin varchar(20);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bir_rdo_code varchar(10);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bir_taxpayer_type varchar(20) DEFAULT 'corporation';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bir_line_of_business text;

-- Seed excise rates (TRAIN Law rates, effective Jan 1, 2020)
-- These are template rates; companies will have their own copies referencing a company_id
-- They are seeded when a company first uses BIR module via bootstrap_bir_defaults()

CREATE OR REPLACE FUNCTION bootstrap_bir_defaults(p_company_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Skip if already seeded
  IF EXISTS (SELECT 1 FROM excise_rates WHERE company_id = p_company_id LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO excise_rates (company_id, product_type, description, rate_per_unit, unit_of_measure, effective_date, bir_classification) VALUES
    (p_company_id, 'diesel',    'Diesel (RR 2-2018)',            6.00,  'liter',   '2020-01-01', 'petroleum'),
    (p_company_id, 'gasoline',  'Gasoline (RR 2-2018)',         10.00,  'liter',   '2020-01-01', 'petroleum'),
    (p_company_id, 'jet_fuel',  'Aviation Turbo Jet Fuel',       4.00,  'liter',   '2020-01-01', 'petroleum'),
    (p_company_id, 'bunker',    'Bunker Fuel Oil',               2.50,  'liter',   '2020-01-01', 'petroleum'),
    (p_company_id, 'kerosene',  'Kerosene',                      3.00,  'liter',   '2020-01-01', 'petroleum'),
    (p_company_id, 'lpg',       'LPG (per kg)',                  3.00,  'kg',      '2020-01-01', 'petroleum'),
    (p_company_id, 'other',     'Other Petroleum Products',      0.00,  'liter',   '2020-01-01', 'petroleum');
END;
$$;
