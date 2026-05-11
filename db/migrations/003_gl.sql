-- 003_gl.sql
-- General ledger: chart of accounts and journal entries

-- Account types (Asset, Liability, Equity, Revenue, Expense)
CREATE TABLE account_types (
  code         varchar(20) PRIMARY KEY,
  name         varchar(50) NOT NULL,
  normal_side  varchar(6) NOT NULL CHECK (normal_side IN ('debit','credit')),
  is_balance_sheet boolean NOT NULL  -- true for assets/liab/equity, false for revenue/expense
);

INSERT INTO account_types (code, name, normal_side, is_balance_sheet) VALUES
  ('ASSET',     'Asset',     'debit',  true),
  ('LIABILITY', 'Liability', 'credit', true),
  ('EQUITY',    'Equity',    'credit', true),
  ('REVENUE',   'Revenue',   'credit', false),
  ('EXPENSE',   'Expense',   'debit',  false)
ON CONFLICT DO NOTHING;

-- Chart of accounts
CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code            varchar(20) NOT NULL,             -- e.g. '1010'
  name            varchar(200) NOT NULL,
  account_type    varchar(20) NOT NULL REFERENCES account_types(code),
  parent_id       uuid REFERENCES accounts(id),     -- hierarchy
  currency        char(3) NOT NULL DEFAULT 'PHP' REFERENCES currencies(code),
  is_active       boolean NOT NULL DEFAULT true,
  is_control      boolean NOT NULL DEFAULT false,   -- e.g. AR control account
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE TRIGGER accounts_updated BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_accounts_company_type ON accounts (company_id, account_type, is_active);

-- Journal entries (header)
CREATE TABLE journal_entries (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       uuid REFERENCES branches(id),
  entry_no        varchar(30) NOT NULL,             -- JV-2026-0152
  entry_date      date NOT NULL,
  fiscal_period_id uuid REFERENCES fiscal_periods(id),
  reference       varchar(100),                     -- source doc reference
  memo            text,
  source_module   varchar(20) NOT NULL DEFAULT 'manual',  -- manual | ar | ap | sales | etc.
  source_doc_type varchar(30),                      -- when auto-generated, which doc type
  source_doc_id   uuid,                             -- when auto-generated, which doc
  status          varchar(20) NOT NULL DEFAULT 'draft', -- draft | pending | posted | voided
  posted_at       timestamptz,
  posted_by       uuid REFERENCES users(id),
  voided_at       timestamptz,
  voided_by       uuid REFERENCES users(id),
  void_reason     text,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, entry_no)
);
CREATE TRIGGER journal_entries_updated BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_je_company_date ON journal_entries (company_id, entry_date DESC);
CREATE INDEX idx_je_status ON journal_entries (status);
CREATE INDEX idx_je_source ON journal_entries (source_module, source_doc_id);

-- Journal entry lines (detail)
CREATE TABLE journal_entry_lines (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id      uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no       int  NOT NULL,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  description   text,
  debit         numeric(18, 4) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit        numeric(18, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency      char(3) NOT NULL DEFAULT 'PHP' REFERENCES currencies(code),
  fx_rate       numeric(18, 8) NOT NULL DEFAULT 1,
  base_debit    numeric(18, 4) NOT NULL DEFAULT 0,  -- in company base currency
  base_credit   numeric(18, 4) NOT NULL DEFAULT 0,
  -- An entry line is either a debit or a credit, never both, never neither
  CHECK ((debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX idx_jel_account ON journal_entry_lines (account_id);
CREATE INDEX idx_jel_entry ON journal_entry_lines (entry_id);

-- Posted balances (denormalized for fast reporting)
-- Updated by trigger on journal_entry_lines when parent entry is posted
CREATE TABLE account_balances (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fiscal_period_id uuid NOT NULL REFERENCES fiscal_periods(id) ON DELETE CASCADE,
  debit_total     numeric(18, 4) NOT NULL DEFAULT 0,
  credit_total    numeric(18, 4) NOT NULL DEFAULT 0,
  UNIQUE (account_id, fiscal_period_id)
);
CREATE INDEX idx_balances_account ON account_balances (account_id);
CREATE INDEX idx_balances_period ON account_balances (fiscal_period_id);

-- Recurring journal entry templates
CREATE TABLE recurring_entries (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            varchar(200) NOT NULL,
  schedule        varchar(20) NOT NULL,             -- monthly | weekly | daily
  next_run_date   date NOT NULL,
  template_lines  jsonb NOT NULL,                   -- array of {account_id, debit, credit, description}
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON CONSTRAINT journal_entry_lines_check ON journal_entry_lines IS 'Each line is either a debit or a credit, never both. Application code must additionally enforce SUM(debit) = SUM(credit) at the entry level before posting.';
