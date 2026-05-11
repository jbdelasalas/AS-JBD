-- 007_bir.sql
-- BIR (Bureau of Internal Revenue) Philippines compliance
-- Tax codes, withholding tax certificates, VAT relief, filing batches

-- Tax codes (VAT, EWT, etc.)
CREATE TABLE tax_codes (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code            varchar(20) NOT NULL,
  name            varchar(100) NOT NULL,
  tax_type        varchar(20) NOT NULL,    -- vat_output | vat_input | ewt | excise | percentage
  rate_pct        numeric(6, 4) NOT NULL,
  account_id      uuid REFERENCES accounts(id),  -- the GL account this tax posts to
  bir_atc_code    varchar(10),                    -- BIR Alphanumeric Tax Code, e.g. 'WC158'
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

-- Pre-loaded common PH tax codes (data only — companies will copy these)
-- Inserted via seed file rather than here so they tie to a real company_id

-- Withholding tax certificates (BIR Form 2307 generation)
CREATE TABLE wht_certificates (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  cert_no         varchar(30) NOT NULL,           -- our internal control no
  bill_id         uuid NOT NULL REFERENCES bills(id),
  supplier_id     uuid NOT NULL REFERENCES suppliers(id),
  bir_atc_code    varchar(10) NOT NULL,
  taxable_amount  numeric(18, 2) NOT NULL,
  rate_pct        numeric(6, 4) NOT NULL,
  amount_withheld numeric(18, 2) NOT NULL,
  period_year     int NOT NULL,
  period_quarter  int NOT NULL CHECK (period_quarter BETWEEN 1 AND 4),
  status          varchar(20) NOT NULL DEFAULT 'draft',  -- draft | issued | filed
  issued_at       timestamptz,
  filed_at        timestamptz,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, cert_no)
);

-- VAT relief detail (data feed for SAWT/SLSP / 2550M attachments)
-- This is an aggregation view rather than a separate ledger; we materialise periodically.
CREATE TABLE vat_relief_entries (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  entry_type      varchar(10) NOT NULL,  -- sales | purchases
  entry_date      date NOT NULL,
  document_no     varchar(50) NOT NULL,  -- SI no or supplier bill no
  partner_tin     varchar(20),
  partner_name    varchar(200) NOT NULL,
  partner_address text,
  taxable_sales_vatable     numeric(18, 2) NOT NULL DEFAULT 0,
  taxable_sales_zero_rated  numeric(18, 2) NOT NULL DEFAULT 0,
  taxable_sales_exempt      numeric(18, 2) NOT NULL DEFAULT 0,
  vat_amount                numeric(18, 2) NOT NULL DEFAULT 0,
  source_doc_type varchar(30),
  source_doc_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vat_relief_company_date ON vat_relief_entries (company_id, entry_date);
CREATE INDEX idx_vat_relief_type_period ON vat_relief_entries (company_id, entry_type, entry_date);

-- BIR filing batches (record of forms filed)
CREATE TABLE bir_filings (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  form_code       varchar(20) NOT NULL,           -- 2550M | 2550Q | 1601-EQ | 1601-C | 1604-E | 0619-E
  form_name       varchar(100) NOT NULL,
  period_type     varchar(10) NOT NULL,           -- monthly | quarterly | annual
  period_year     int NOT NULL,
  period_month    int CHECK (period_month BETWEEN 1 AND 12),
  period_quarter  int CHECK (period_quarter BETWEEN 1 AND 4),
  due_date        date NOT NULL,
  filed_date      date,
  status          varchar(20) NOT NULL DEFAULT 'draft',  -- draft | ready | filed | amended
  total_due       numeric(18, 2) NOT NULL DEFAULT 0,
  total_paid      numeric(18, 2) NOT NULL DEFAULT 0,
  reference_no    varchar(50),                     -- BIR confirmation number
  notes           text,
  filed_by        uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER bir_filings_updated BEFORE UPDATE ON bir_filings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
