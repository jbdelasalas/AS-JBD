-- 001_init.sql
-- Core extensions and shared utilities for Perpet ERP

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Helper: trigger to auto-update updated_at column
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Companies (multi-entity support)
CREATE TABLE companies (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code         varchar(20)  NOT NULL UNIQUE,
  name         varchar(200) NOT NULL,
  legal_name   varchar(200),
  tin          varchar(20),                    -- BIR TIN, e.g. 123-456-789-000
  rdo_code     varchar(10),                    -- BIR RDO
  address      text,
  base_currency char(3) NOT NULL DEFAULT 'PHP',
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Branches (depot, retail station, head office)
CREATE TABLE branches (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code         varchar(20)  NOT NULL,
  name         varchar(200) NOT NULL,
  branch_type  varchar(20)  NOT NULL DEFAULT 'office',  -- office | depot | retail_station
  address      text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE TRIGGER branches_updated BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Currencies
CREATE TABLE currencies (
  code        char(3) PRIMARY KEY,
  name        varchar(50) NOT NULL,
  symbol      varchar(10)
);
INSERT INTO currencies (code, name, symbol) VALUES
  ('PHP', 'Philippine Peso', '₱'),
  ('USD', 'US Dollar', '$'),
  ('EUR', 'Euro', '€')
ON CONFLICT DO NOTHING;

-- Exchange rates (daily snapshots)
CREATE TABLE fx_rates (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_currency char(3) NOT NULL REFERENCES currencies(code),
  to_currency   char(3) NOT NULL REFERENCES currencies(code),
  rate          numeric(18, 8) NOT NULL,
  rate_date     date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_currency, to_currency, rate_date)
);

-- Fiscal periods (for period locking)
CREATE TABLE fiscal_periods (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year        int  NOT NULL,
  period      int  NOT NULL CHECK (period BETWEEN 1 AND 12),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      varchar(20) NOT NULL DEFAULT 'open',  -- open | closing | closed
  closed_at   timestamptz,
  closed_by   uuid,
  UNIQUE (company_id, year, period)
);

-- Audit log: every state-changing action lands here
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  user_id      uuid,
  company_id   uuid,
  action       varchar(50)  NOT NULL,        -- create | update | delete | post | void | login | etc.
  entity_type  varchar(100) NOT NULL,        -- journal_entry | invoice | etc.
  entity_id    uuid,
  before_state jsonb,
  after_state  jsonb,
  ip_address   inet,
  user_agent   text
);
CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_user_time ON audit_log (user_id, occurred_at DESC);

-- Document series (BIR-controlled invoice/OR/DR numbering)
CREATE TABLE document_series (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id       uuid REFERENCES branches(id),
  doc_type        varchar(30) NOT NULL,           -- sales_invoice | official_receipt | delivery_receipt | credit_memo | journal_voucher
  prefix          varchar(20) NOT NULL,
  start_number    bigint NOT NULL DEFAULT 1,
  end_number      bigint,
  current_number  bigint NOT NULL DEFAULT 0,      -- last issued
  bir_permit_no   varchar(50),                    -- e.g. CAS-2026-LZ-XXXX
  bir_permit_date date,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER document_series_updated BEFORE UPDATE ON document_series FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE document_series IS 'BIR CAS-controlled document numbering. Issuing a number must be done in a transaction with the document insert to prevent gaps.';
