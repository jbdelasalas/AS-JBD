-- ============================================================================
-- Perpet ERP — combined Supabase migration
-- ============================================================================
-- Paste this entire file into Supabase SQL Editor and click Run.
-- It bundles all 7 schema migrations and 3 seed files into one transaction.
--
-- Run this BEFORE deploying the API. After running:
--   - Default login: admin@perpet.com.ph / Perpet2026!
--   - Demo company: Perpet Pilipinas Corp.
-- ============================================================================


-- ============================================================================
-- 001_init.sql
-- ============================================================================
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
CREATE TABLE IF NOT EXISTS companies (
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
CREATE OR REPLACE TRIGGER companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Branches (depot, retail station, head office)
CREATE TABLE IF NOT EXISTS branches (
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
CREATE OR REPLACE TRIGGER branches_updated BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Currencies
CREATE TABLE IF NOT EXISTS currencies (
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
CREATE TABLE IF NOT EXISTS fx_rates (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_currency char(3) NOT NULL REFERENCES currencies(code),
  to_currency   char(3) NOT NULL REFERENCES currencies(code),
  rate          numeric(18, 8) NOT NULL,
  rate_date     date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_currency, to_currency, rate_date)
);

-- Fiscal periods (for period locking)
CREATE TABLE IF NOT EXISTS fiscal_periods (
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
CREATE TABLE IF NOT EXISTS audit_log (
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
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log (user_id, occurred_at DESC);

-- Document series (BIR-controlled invoice/OR/DR numbering)
CREATE TABLE IF NOT EXISTS document_series (
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
CREATE OR REPLACE TRIGGER document_series_updated BEFORE UPDATE ON document_series FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE document_series IS 'BIR CAS-controlled document numbering. Issuing a number must be done in a transaction with the document insert to prevent gaps.';

-- ============================================================================
-- 002_auth_rbac.sql
-- ============================================================================
-- 002_auth_rbac.sql
-- Users, roles, permissions

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           varchar(200) NOT NULL UNIQUE,
  password_hash   varchar(200) NOT NULL,        -- bcrypt
  full_name       varchar(200) NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  is_superadmin   boolean NOT NULL DEFAULT false,
  twofa_secret    varchar(100),
  twofa_enabled   boolean NOT NULL DEFAULT false,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh tokens for JWT rotation
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  varchar(200) NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

-- Roles (system-wide role definitions)
CREATE TABLE IF NOT EXISTS roles (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code         varchar(50) NOT NULL UNIQUE,        -- e.g. 'finance_manager'
  name         varchar(100) NOT NULL,
  description  text
);

INSERT INTO roles (code, name, description) VALUES
  ('superadmin',       'Super administrator', 'Unrestricted system access'),
  ('finance_manager',  'Finance manager',     'Full accounting and approvals'),
  ('accountant',       'Accountant',          'Post journal entries, run reports'),
  ('ap_clerk',         'AP clerk',            'Enter and process bills'),
  ('ar_clerk',         'AR clerk',            'Issue invoices and receipts'),
  ('procurement',      'Procurement officer', 'Create POs and receive goods'),
  ('depot_supervisor', 'Depot supervisor',    'Tank readings and dispatch'),
  ('station_attendant','Station attendant',   'Pump sales and shift reports'),
  ('readonly',         'Read-only viewer',    'View reports only')
ON CONFLICT DO NOTHING;

-- Permissions (module + action grain)
CREATE TABLE IF NOT EXISTS permissions (
  id     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code   varchar(80) NOT NULL UNIQUE,       -- e.g. 'gl.journal.post'
  module varchar(30) NOT NULL,              -- gl | ar | ap | sales | etc.
  action varchar(30) NOT NULL,              -- view | create | update | delete | post | void | approve
  name   varchar(150) NOT NULL
);

INSERT INTO permissions (code, module, action, name) VALUES
  ('gl.account.view',     'gl',         'view',    'View chart of accounts'),
  ('gl.account.manage',   'gl',         'manage',  'Manage chart of accounts'),
  ('gl.journal.view',     'gl',         'view',    'View journal entries'),
  ('gl.journal.create',   'gl',         'create',  'Create journal entries'),
  ('gl.journal.post',     'gl',         'post',    'Post journal entries'),
  ('gl.journal.void',     'gl',         'void',    'Void posted entries'),
  ('gl.period.close',     'gl',         'close',   'Close fiscal periods'),
  ('ar.invoice.view',     'ar',         'view',    'View invoices'),
  ('ar.invoice.create',   'ar',         'create',  'Create invoices'),
  ('ar.invoice.post',     'ar',         'post',    'Post invoices'),
  ('ar.payment.receive',  'ar',         'create',  'Receive payments'),
  ('ap.bill.view',        'ap',         'view',    'View bills'),
  ('ap.bill.create',      'ap',         'create',  'Enter bills'),
  ('ap.bill.approve',     'ap',         'approve', 'Approve bills'),
  ('ap.payment.create',   'ap',         'create',  'Pay bills'),
  ('inventory.view',      'inventory',  'view',    'View inventory'),
  ('inventory.adjust',    'inventory',  'update',  'Adjust inventory'),
  ('fuel.tank.read',      'fuel',       'view',    'View tank readings'),
  ('fuel.tank.dip',       'fuel',       'create',  'Record tank dip'),
  ('fuel.delivery.create','fuel',       'create',  'Record fuel delivery'),
  ('reports.view',        'reports',    'view',    'View financial reports'),
  ('admin.user.manage',   'admin',      'manage',  'Manage users'),
  ('admin.role.manage',   'admin',      'manage',  'Manage roles')
ON CONFLICT DO NOTHING;

-- Role-permission mapping
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- User-role assignment (scoped per company)
-- We use a surrogate id and unique indexes because Postgres doesn't allow
-- expressions (like COALESCE for nullable columns) inside a PRIMARY KEY.
CREATE TABLE IF NOT EXISTS user_roles (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,  -- NULL = applies to all companies
  branch_id   uuid REFERENCES branches(id) ON DELETE CASCADE,   -- NULL = applies to all branches
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Prevent duplicate assignment whether company_id is set or null
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_unique_with_company
  ON user_roles (user_id, role_id, company_id)
  WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_unique_no_company
  ON user_roles (user_id, role_id)
  WHERE company_id IS NULL;

-- Grant all permissions to superadmin (data migration)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'superadmin'
ON CONFLICT DO NOTHING;

-- Grant common GL permissions to accountant
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'accountant'
  AND p.code IN ('gl.account.view','gl.journal.view','gl.journal.create','gl.journal.post','reports.view','ar.invoice.view','ap.bill.view')
ON CONFLICT DO NOTHING;

-- Read-only role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'readonly' AND p.action = 'view'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 003_gl.sql
-- ============================================================================
-- 003_gl.sql
-- General ledger: chart of accounts and journal entries

-- Account types (Asset, Liability, Equity, Revenue, Expense)
CREATE TABLE IF NOT EXISTS account_types (
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
CREATE TABLE IF NOT EXISTS accounts (
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
CREATE OR REPLACE TRIGGER accounts_updated BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_accounts_company_type ON accounts (company_id, account_type, is_active);

-- Journal entries (header)
CREATE TABLE IF NOT EXISTS journal_entries (
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
CREATE OR REPLACE TRIGGER journal_entries_updated BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_je_company_date ON journal_entries (company_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_je_status ON journal_entries (status);
CREATE INDEX IF NOT EXISTS idx_je_source ON journal_entries (source_module, source_doc_id);

-- Journal entry lines (detail)
CREATE TABLE IF NOT EXISTS journal_entry_lines (
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
CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines (account_id);
CREATE INDEX IF NOT EXISTS idx_jel_entry ON journal_entry_lines (entry_id);

-- Posted balances (denormalized for fast reporting)
-- Updated by trigger on journal_entry_lines when parent entry is posted
CREATE TABLE IF NOT EXISTS account_balances (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fiscal_period_id uuid NOT NULL REFERENCES fiscal_periods(id) ON DELETE CASCADE,
  debit_total     numeric(18, 4) NOT NULL DEFAULT 0,
  credit_total    numeric(18, 4) NOT NULL DEFAULT 0,
  UNIQUE (account_id, fiscal_period_id)
);
CREATE INDEX IF NOT EXISTS idx_balances_account ON account_balances (account_id);
CREATE INDEX IF NOT EXISTS idx_balances_period ON account_balances (fiscal_period_id);

-- Recurring journal entry templates
CREATE TABLE IF NOT EXISTS recurring_entries (
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

-- ============================================================================
-- 004_ar_ap.sql
-- ============================================================================
-- 004_ar_ap.sql
-- Accounts receivable and accounts payable

-- ============================================================================
-- CUSTOMERS (AR)
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code              varchar(30) NOT NULL,
  name              varchar(200) NOT NULL,
  customer_type     varchar(20) NOT NULL DEFAULT 'wholesale',  -- wholesale | retail | fleet | gov
  tin               varchar(20),
  address           text,
  contact_person    varchar(100),
  email             varchar(200),
  phone             varchar(50),
  payment_terms_days int NOT NULL DEFAULT 30,
  credit_limit      numeric(18, 2) NOT NULL DEFAULT 0,
  is_vat_exempt     boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  ar_account_id     uuid REFERENCES accounts(id),       -- override default AR control account
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE OR REPLACE TRIGGER customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sales invoices
CREATE TABLE IF NOT EXISTS sales_invoices (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       uuid REFERENCES branches(id),
  invoice_no      varchar(30) NOT NULL,                 -- BIR-controlled, e.g. SI-2026-001124
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_date    date NOT NULL,
  due_date        date NOT NULL,
  reference       varchar(100),
  currency        char(3) NOT NULL DEFAULT 'PHP',
  subtotal        numeric(18, 2) NOT NULL DEFAULT 0,    -- sum of line totals before tax
  vat_amount      numeric(18, 2) NOT NULL DEFAULT 0,    -- output VAT
  total           numeric(18, 2) NOT NULL DEFAULT 0,    -- subtotal + vat
  amount_paid     numeric(18, 2) NOT NULL DEFAULT 0,
  balance         numeric(18, 2) NOT NULL DEFAULT 0,    -- total - amount_paid
  status          varchar(20) NOT NULL DEFAULT 'draft', -- draft | posted | partial | paid | voided
  posted_at       timestamptz,
  je_id           uuid REFERENCES journal_entries(id),  -- the GL posting
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_no)
);
CREATE OR REPLACE TRIGGER sales_invoices_updated BEFORE UPDATE ON sales_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_si_customer_date ON sales_invoices (customer_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_si_status ON sales_invoices (status);

CREATE TABLE IF NOT EXISTS sales_invoice_lines (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id      uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  line_no         int NOT NULL,
  item_id         uuid,                                -- references items(id), added in 005
  description     text NOT NULL,
  quantity        numeric(18, 4) NOT NULL,
  unit_price      numeric(18, 4) NOT NULL,
  discount_pct    numeric(5, 2) NOT NULL DEFAULT 0,
  vat_rate        numeric(5, 2) NOT NULL DEFAULT 12.00,  -- PH standard 12%
  line_subtotal   numeric(18, 2) NOT NULL,             -- quantity * unit_price * (1 - discount_pct/100)
  line_vat        numeric(18, 2) NOT NULL,
  line_total      numeric(18, 2) NOT NULL,
  revenue_account_id uuid REFERENCES accounts(id),
  UNIQUE (invoice_id, line_no)
);

-- Customer payments / official receipts
CREATE TABLE IF NOT EXISTS customer_payments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       uuid REFERENCES branches(id),
  receipt_no      varchar(30) NOT NULL,                 -- OR-2026-000892
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  payment_date    date NOT NULL,
  payment_method  varchar(20) NOT NULL,                 -- cash | check | bank_transfer | credit_card
  reference       varchar(100),                         -- check number, transaction ID
  amount          numeric(18, 2) NOT NULL,
  bank_account_id uuid REFERENCES accounts(id),         -- which bank account hit
  status          varchar(20) NOT NULL DEFAULT 'draft', -- draft | posted | voided
  posted_at       timestamptz,
  je_id           uuid REFERENCES journal_entries(id),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, receipt_no)
);
CREATE OR REPLACE TRIGGER customer_payments_updated BEFORE UPDATE ON customer_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Payment-to-invoice application (one payment can settle many invoices)
CREATE TABLE IF NOT EXISTS payment_applications (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id      uuid NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  invoice_id      uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  amount_applied  numeric(18, 2) NOT NULL CHECK (amount_applied > 0)
);

-- ============================================================================
-- SUPPLIERS (AP)
-- ============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code              varchar(30) NOT NULL,
  name              varchar(200) NOT NULL,
  supplier_type     varchar(20) NOT NULL DEFAULT 'trade',  -- trade | utility | service | refinery
  tin               varchar(20),
  address           text,
  contact_person    varchar(100),
  email             varchar(200),
  phone             varchar(50),
  payment_terms_days int NOT NULL DEFAULT 30,
  is_vat_registered boolean NOT NULL DEFAULT true,
  ewt_rate          numeric(5, 2) NOT NULL DEFAULT 1.00,  -- expanded WHT rate, supplier-specific
  is_active         boolean NOT NULL DEFAULT true,
  ap_account_id     uuid REFERENCES accounts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE OR REPLACE TRIGGER suppliers_updated BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Vendor bills
CREATE TABLE IF NOT EXISTS bills (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       uuid REFERENCES branches(id),
  bill_no         varchar(50) NOT NULL,                 -- supplier's invoice number
  internal_no     varchar(30) NOT NULL,                 -- our reference, BL-2026-0317
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  bill_date       date NOT NULL,
  due_date        date NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'PHP',
  subtotal        numeric(18, 2) NOT NULL DEFAULT 0,
  vat_amount      numeric(18, 2) NOT NULL DEFAULT 0,    -- input VAT
  ewt_amount      numeric(18, 2) NOT NULL DEFAULT 0,    -- expanded WHT withheld
  total           numeric(18, 2) NOT NULL DEFAULT 0,
  amount_paid     numeric(18, 2) NOT NULL DEFAULT 0,
  balance         numeric(18, 2) NOT NULL DEFAULT 0,
  status          varchar(20) NOT NULL DEFAULT 'draft', -- draft | pending_approval | approved | paid | voided
  approved_by     uuid REFERENCES users(id),
  approved_at     timestamptz,
  posted_at       timestamptz,
  je_id           uuid REFERENCES journal_entries(id),
  po_id           uuid,                                  -- references purchase_orders, added in 005
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, internal_no)
);
CREATE OR REPLACE TRIGGER bills_updated BEFORE UPDATE ON bills FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_bills_supplier_date ON bills (supplier_id, bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills (status);

CREATE TABLE IF NOT EXISTS bill_lines (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id         uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  line_no         int NOT NULL,
  item_id         uuid,
  description     text NOT NULL,
  quantity        numeric(18, 4) NOT NULL,
  unit_price      numeric(18, 4) NOT NULL,
  vat_rate        numeric(5, 2) NOT NULL DEFAULT 12.00,
  line_subtotal   numeric(18, 2) NOT NULL,
  line_vat        numeric(18, 2) NOT NULL,
  line_total      numeric(18, 2) NOT NULL,
  expense_account_id uuid REFERENCES accounts(id),
  UNIQUE (bill_id, line_no)
);

-- Supplier payments / vouchers
CREATE TABLE IF NOT EXISTS supplier_payments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  voucher_no      varchar(30) NOT NULL,                  -- CV-2026-000124
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  payment_date    date NOT NULL,
  payment_method  varchar(20) NOT NULL,
  reference       varchar(100),
  amount          numeric(18, 2) NOT NULL,
  bank_account_id uuid REFERENCES accounts(id),
  status          varchar(20) NOT NULL DEFAULT 'draft',
  posted_at       timestamptz,
  je_id           uuid REFERENCES journal_entries(id),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, voucher_no)
);
CREATE OR REPLACE TRIGGER supplier_payments_updated BEFORE UPDATE ON supplier_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS bill_payment_applications (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id      uuid NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  bill_id         uuid NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  amount_applied  numeric(18, 2) NOT NULL CHECK (amount_applied > 0)
);

-- ============================================================================
-- 005_inventory_sales_purch.sql
-- ============================================================================
-- 005_inventory_sales_purch.sql
-- Inventory items, warehouses, stock movements, sales orders, purchase orders

-- Item categories
CREATE TABLE IF NOT EXISTS item_categories (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        varchar(20) NOT NULL,
  name        varchar(100) NOT NULL,
  parent_id   uuid REFERENCES item_categories(id),
  UNIQUE (company_id, code)
);

-- Items / SKUs
CREATE TABLE IF NOT EXISTS items (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku                 varchar(50) NOT NULL,
  name                varchar(200) NOT NULL,
  description         text,
  category_id         uuid REFERENCES item_categories(id),
  uom                 varchar(20) NOT NULL,                  -- liter | kg | pc | drum
  item_type           varchar(20) NOT NULL DEFAULT 'stock',  -- stock | service | bundle
  is_fuel             boolean NOT NULL DEFAULT false,        -- triggers fuel-specific behavior
  fuel_type           varchar(30),                           -- diesel | gasoline_91 | gasoline_95 | gasoline_97 | kerosene | lpg
  costing_method      varchar(20) NOT NULL DEFAULT 'average',-- average | fifo
  standard_cost       numeric(18, 4) NOT NULL DEFAULT 0,
  selling_price       numeric(18, 4) NOT NULL DEFAULT 0,
  reorder_point       numeric(18, 4) NOT NULL DEFAULT 0,
  reorder_qty         numeric(18, 4) NOT NULL DEFAULT 0,
  inventory_account_id uuid REFERENCES accounts(id),
  cogs_account_id      uuid REFERENCES accounts(id),
  revenue_account_id   uuid REFERENCES accounts(id),
  excise_tax_per_unit  numeric(18, 4) NOT NULL DEFAULT 0,    -- BIR excise tax for fuel
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);
CREATE OR REPLACE TRIGGER items_updated BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_items_company_active ON items (company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_items_fuel ON items (is_fuel) WHERE is_fuel = true;

-- Warehouses (depot, retail station tank farm, etc.)
CREATE TABLE IF NOT EXISTS warehouses (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id       uuid REFERENCES branches(id),
  code            varchar(20) NOT NULL,
  name            varchar(100) NOT NULL,
  warehouse_type  varchar(20) NOT NULL DEFAULT 'general',  -- general | depot | tank_farm | retail
  address         text,
  is_active       boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

-- Stock balances (per item per warehouse)
CREATE TABLE IF NOT EXISTS stock_balances (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  qty_on_hand     numeric(18, 4) NOT NULL DEFAULT 0,
  avg_cost        numeric(18, 4) NOT NULL DEFAULT 0,
  last_movement_at timestamptz,
  UNIQUE (item_id, warehouse_id)
);

-- Stock movements (immutable transaction log)
CREATE TABLE IF NOT EXISTS stock_movements (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  item_id         uuid NOT NULL REFERENCES items(id),
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  movement_type   varchar(30) NOT NULL,            -- receipt | issue | transfer_in | transfer_out | adjustment | sale | purchase
  movement_date   timestamptz NOT NULL DEFAULT now(),
  quantity        numeric(18, 4) NOT NULL,         -- signed: positive in, negative out
  unit_cost       numeric(18, 4) NOT NULL,
  total_cost      numeric(18, 4) NOT NULL,
  reference_type  varchar(30),                     -- sales_invoice | bill | adjustment | etc.
  reference_id    uuid,
  reference_no    varchar(50),
  notes           text,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sm_item_warehouse_date ON stock_movements (item_id, warehouse_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_sm_reference ON stock_movements (reference_type, reference_id);

-- ============================================================================
-- SALES ORDERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales_orders (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  branch_id       uuid REFERENCES branches(id),
  order_no        varchar(30) NOT NULL,
  customer_id     uuid NOT NULL REFERENCES customers(id),
  order_date      date NOT NULL,
  delivery_date   date,
  reference       varchar(100),
  subtotal        numeric(18, 2) NOT NULL DEFAULT 0,
  vat_amount      numeric(18, 2) NOT NULL DEFAULT 0,
  total           numeric(18, 2) NOT NULL DEFAULT 0,
  status          varchar(20) NOT NULL DEFAULT 'open',  -- open | partial | fulfilled | cancelled
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, order_no)
);
CREATE OR REPLACE TRIGGER sales_orders_updated BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  line_no         int NOT NULL,
  item_id         uuid NOT NULL REFERENCES items(id),
  description     text NOT NULL,
  quantity        numeric(18, 4) NOT NULL,
  qty_delivered   numeric(18, 4) NOT NULL DEFAULT 0,
  unit_price      numeric(18, 4) NOT NULL,
  vat_rate        numeric(5, 2) NOT NULL DEFAULT 12.00,
  line_total      numeric(18, 2) NOT NULL,
  UNIQUE (order_id, line_no)
);

-- ============================================================================
-- PURCHASE ORDERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  branch_id       uuid REFERENCES branches(id),
  po_no           varchar(30) NOT NULL,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id),
  po_date         date NOT NULL,
  expected_date   date,
  reference       varchar(100),
  subtotal        numeric(18, 2) NOT NULL DEFAULT 0,
  vat_amount      numeric(18, 2) NOT NULL DEFAULT 0,
  total           numeric(18, 2) NOT NULL DEFAULT 0,
  status          varchar(20) NOT NULL DEFAULT 'draft', -- draft | pending_approval | approved | partial | received | closed | cancelled
  approved_by     uuid REFERENCES users(id),
  approved_at     timestamptz,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, po_no)
);
CREATE OR REPLACE TRIGGER purchase_orders_updated BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id           uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no         int NOT NULL,
  item_id         uuid NOT NULL REFERENCES items(id),
  description     text NOT NULL,
  quantity        numeric(18, 4) NOT NULL,
  qty_received    numeric(18, 4) NOT NULL DEFAULT 0,
  unit_price      numeric(18, 4) NOT NULL,
  vat_rate        numeric(5, 2) NOT NULL DEFAULT 12.00,
  line_total      numeric(18, 2) NOT NULL,
  UNIQUE (po_id, line_no)
);

-- Goods receipt (receiving against PO)
CREATE TABLE IF NOT EXISTS goods_receipts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  grn_no          varchar(30) NOT NULL,
  po_id           uuid NOT NULL REFERENCES purchase_orders(id),
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  receipt_date    date NOT NULL,
  delivery_no     varchar(50),                       -- supplier's DR
  notes           text,
  status          varchar(20) NOT NULL DEFAULT 'draft', -- draft | posted | voided
  posted_at       timestamptz,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, grn_no)
);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  grn_id          uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_line_id      uuid NOT NULL REFERENCES purchase_order_lines(id),
  line_no         int NOT NULL,
  qty_received    numeric(18, 4) NOT NULL,
  unit_cost       numeric(18, 4) NOT NULL,
  UNIQUE (grn_id, line_no)
);

-- Add the FK from bills.po_id now that purchase_orders exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'bills_po_id_fk' AND table_name = 'bills'
  ) THEN
    ALTER TABLE bills ADD CONSTRAINT bills_po_id_fk FOREIGN KEY (po_id) REFERENCES purchase_orders(id);
  END IF;
END $$;

-- ============================================================================
-- 006_fuel.sql
-- ============================================================================
-- 006_fuel.sql
-- Fuel-specific operations for Perpet Pilipinas Corp.
-- Storage tanks, dip readings, fuel deliveries with temperature/density compensation,
-- and dispensing pumps for retail stations.
--
-- Key fuel industry concepts:
--   - Volume changes with temperature. Trade is settled in "litres at 15°C" (L15).
--   - Density (kg/L) varies by product and temperature.
--   - Tank dip readings give a physical measurement; book stock comes from movements.
--   - Reconciliation gain/loss = book qty - measured qty (must be explained).

-- ============================================================================
-- STORAGE TANKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS fuel_tanks (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  tank_no         varchar(20) NOT NULL,                -- e.g. T-01
  tank_name       varchar(100),
  item_id         uuid NOT NULL REFERENCES items(id),  -- the fuel product stored
  capacity_litres numeric(18, 2) NOT NULL,             -- nominal capacity
  safe_fill_litres numeric(18, 2),                     -- max practical fill
  dead_stock_litres numeric(18, 2) NOT NULL DEFAULT 0, -- unpumpable bottom
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, tank_no)
);
CREATE OR REPLACE TRIGGER fuel_tanks_updated BEFORE UPDATE ON fuel_tanks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tank dip / gauge readings (operator records physical level)
CREATE TABLE IF NOT EXISTS tank_readings (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tank_id         uuid NOT NULL REFERENCES fuel_tanks(id) ON DELETE CASCADE,
  reading_at      timestamptz NOT NULL DEFAULT now(),
  reading_type    varchar(20) NOT NULL DEFAULT 'manual',  -- manual | atg | shift_open | shift_close
  dip_cm          numeric(10, 2),                          -- physical dip stick reading
  observed_litres numeric(18, 2) NOT NULL,                 -- volume at observed temperature
  observed_temp_c numeric(6, 2),                           -- product temperature
  density_kg_l    numeric(10, 4),                          -- observed density
  litres_at_15c   numeric(18, 2),                          -- temperature-corrected volume (L15)
  water_cm        numeric(10, 2) DEFAULT 0,                -- water bottom
  notes           text,
  recorded_by     uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tank_readings_tank_time ON tank_readings (tank_id, reading_at DESC);

-- ============================================================================
-- FUEL DELIVERIES (inbound from refinery / supplier)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fuel_deliveries (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  delivery_no       varchar(30) NOT NULL,                  -- FD-2026-000123
  supplier_id       uuid NOT NULL REFERENCES suppliers(id),
  po_id             uuid REFERENCES purchase_orders(id),
  warehouse_id      uuid NOT NULL REFERENCES warehouses(id),
  tank_id           uuid NOT NULL REFERENCES fuel_tanks(id),
  item_id           uuid NOT NULL REFERENCES items(id),
  delivery_date     timestamptz NOT NULL,
  truck_plate_no    varchar(20),
  driver_name       varchar(100),
  bol_no            varchar(50),                            -- Bill of Lading / withdrawal certificate
  -- Loaded at origin (refinery)
  loaded_litres_15c numeric(18, 2),
  loaded_litres_obs numeric(18, 2),
  loaded_temp_c     numeric(6, 2),
  loaded_density    numeric(10, 4),
  -- Received at destination (our depot)
  received_litres_15c numeric(18, 2) NOT NULL,
  received_litres_obs numeric(18, 2) NOT NULL,
  received_temp_c   numeric(6, 2),
  received_density  numeric(10, 4),
  -- Variance
  variance_litres   numeric(18, 2) GENERATED ALWAYS AS (received_litres_15c - COALESCE(loaded_litres_15c, received_litres_15c)) STORED,
  -- Tank level before/after
  tank_reading_before_id uuid REFERENCES tank_readings(id),
  tank_reading_after_id  uuid REFERENCES tank_readings(id),
  -- Costing
  unit_cost         numeric(18, 4),                          -- cost per litre L15
  excise_tax_amount numeric(18, 2) NOT NULL DEFAULT 0,       -- BIR excise on fuel
  vat_amount        numeric(18, 2) NOT NULL DEFAULT 0,
  total_cost        numeric(18, 2),
  status            varchar(20) NOT NULL DEFAULT 'draft',    -- draft | posted | voided
  posted_at         timestamptz,
  bill_id           uuid REFERENCES bills(id),               -- linked AP bill from refinery
  je_id             uuid REFERENCES journal_entries(id),
  notes             text,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, delivery_no)
);
CREATE OR REPLACE TRIGGER fuel_deliveries_updated BEFORE UPDATE ON fuel_deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_fd_supplier_date ON fuel_deliveries (supplier_id, delivery_date DESC);
CREATE INDEX IF NOT EXISTS idx_fd_tank ON fuel_deliveries (tank_id);

COMMENT ON COLUMN fuel_deliveries.received_litres_15c IS 'Trade-recognised volume in litres at 15°C. This is the quantity that posts to inventory.';

-- ============================================================================
-- DISPENSING PUMPS (retail stations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pumps (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  tank_id         uuid NOT NULL REFERENCES fuel_tanks(id),
  pump_no         varchar(20) NOT NULL,
  nozzle_no       varchar(10),
  item_id         uuid NOT NULL REFERENCES items(id),
  is_active       boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, pump_no, nozzle_no)
);

-- Pump totaliser readings (cumulative odometer-style counter)
-- Sale qty = current_totaliser - previous_totaliser
CREATE TABLE IF NOT EXISTS pump_readings (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pump_id         uuid NOT NULL REFERENCES pumps(id) ON DELETE CASCADE,
  reading_at      timestamptz NOT NULL DEFAULT now(),
  shift_id        uuid,                                 -- optional shift link
  totaliser_litres numeric(18, 4) NOT NULL,
  totaliser_amount numeric(18, 2) NOT NULL,
  recorded_by     uuid NOT NULL REFERENCES users(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pump_readings_pump_time ON pump_readings (pump_id, reading_at DESC);

-- Retail shifts (operator on-duty period)
CREATE TABLE IF NOT EXISTS retail_shifts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  shift_no        varchar(30) NOT NULL,
  attendant_id    uuid NOT NULL REFERENCES users(id),
  shift_start     timestamptz NOT NULL,
  shift_end       timestamptz,
  cash_collected  numeric(18, 2) NOT NULL DEFAULT 0,
  card_collected  numeric(18, 2) NOT NULL DEFAULT 0,
  cheque_collected numeric(18, 2) NOT NULL DEFAULT 0,
  expected_collection numeric(18, 2),  -- from pump readings * price
  variance        numeric(18, 2),       -- cash + card - expected
  status          varchar(20) NOT NULL DEFAULT 'open',  -- open | closed | reconciled
  closed_at       timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, shift_no)
);
CREATE OR REPLACE TRIGGER retail_shifts_updated BEFORE UPDATE ON retail_shifts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- FUEL RECONCILIATION (tank book vs measured)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fuel_reconciliations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  tank_id         uuid NOT NULL REFERENCES fuel_tanks(id),
  recon_date      date NOT NULL,
  opening_book_litres   numeric(18, 2) NOT NULL,
  receipts_litres       numeric(18, 2) NOT NULL DEFAULT 0,
  sales_litres          numeric(18, 2) NOT NULL DEFAULT 0,
  transfers_out_litres  numeric(18, 2) NOT NULL DEFAULT 0,
  closing_book_litres   numeric(18, 2) NOT NULL,
  measured_litres_15c   numeric(18, 2) NOT NULL,           -- tank dip on recon_date
  variance_litres       numeric(18, 2) GENERATED ALWAYS AS (measured_litres_15c - closing_book_litres) STORED,
  variance_pct          numeric(8, 4),                      -- variance / sales (industry tolerance ~0.5%)
  status                varchar(20) NOT NULL DEFAULT 'draft', -- draft | reviewed | posted
  je_id                 uuid REFERENCES journal_entries(id), -- adjustment posting
  notes                 text,
  reviewed_by           uuid REFERENCES users(id),
  reviewed_at           timestamptz,
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tank_id, recon_date)
);
CREATE INDEX IF NOT EXISTS idx_fuel_recon_tank_date ON fuel_reconciliations (tank_id, recon_date DESC);

COMMENT ON TABLE fuel_reconciliations IS 'Daily/shift reconciliation of book stock vs physically measured stock. Variances within tolerance go to Inventory Variance expense; variances outside tolerance require review and explanation.';

-- ============================================================================
-- 007_bir.sql
-- ============================================================================
-- 007_bir.sql
-- BIR (Bureau of Internal Revenue) Philippines compliance
-- Tax codes, withholding tax certificates, VAT relief, filing batches

-- Tax codes (VAT, EWT, etc.)
CREATE TABLE IF NOT EXISTS tax_codes (
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
CREATE TABLE IF NOT EXISTS wht_certificates (
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
CREATE TABLE IF NOT EXISTS vat_relief_entries (
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
CREATE INDEX IF NOT EXISTS idx_vat_relief_company_date ON vat_relief_entries (company_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_vat_relief_type_period ON vat_relief_entries (company_id, entry_type, entry_date);

-- BIR filing batches (record of forms filed)
CREATE TABLE IF NOT EXISTS bir_filings (
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
CREATE OR REPLACE TRIGGER bir_filings_updated BEFORE UPDATE ON bir_filings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- MIGRATION 008: AR MODULE COMPLETE
-- ============================================================================

-- Enhance sales_orders
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS notes              text,
  ADD COLUMN IF NOT EXISTS payment_terms_days int NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS discount_pct       numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warehouse_id       uuid REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS approved_by        uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at        timestamptz,
  ADD COLUMN IF NOT EXISTS approval_notes     text,
  ADD COLUMN IF NOT EXISTS cancelled_by       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason      text,
  ADD COLUMN IF NOT EXISTS credit_checked     boolean NOT NULL DEFAULT false;

ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS qty_reserved   numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost      numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_pct   numeric(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_subtotal  numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_vat       numeric(18,2) NOT NULL DEFAULT 0;

-- Enhance sales_invoices
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS so_id              uuid REFERENCES sales_orders(id),
  ADD COLUMN IF NOT EXISTS notes              text,
  ADD COLUMN IF NOT EXISTS payment_terms_days int NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS discount_amount    numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by        uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at        timestamptz,
  ADD COLUMN IF NOT EXISTS voided_at          timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by          uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason        text;

-- Delivery receipts
CREATE TABLE IF NOT EXISTS delivery_receipts (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id     uuid REFERENCES branches(id),
  dr_no         varchar(30) NOT NULL,
  so_id         uuid NOT NULL REFERENCES sales_orders(id),
  customer_id   uuid NOT NULL REFERENCES customers(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  delivery_date date NOT NULL,
  notes         text,
  status        varchar(20) NOT NULL DEFAULT 'draft',
  posted_at     timestamptz,
  posted_by     uuid REFERENCES users(id),
  je_id         uuid REFERENCES journal_entries(id),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, dr_no)
);
CREATE OR REPLACE TRIGGER delivery_receipts_updated
  BEFORE UPDATE ON delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_dr_so     ON delivery_receipts (so_id);
CREATE INDEX IF NOT EXISTS idx_dr_status ON delivery_receipts (status);

CREATE TABLE IF NOT EXISTS delivery_receipt_lines (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  dr_id         uuid NOT NULL REFERENCES delivery_receipts(id) ON DELETE CASCADE,
  so_line_id    uuid REFERENCES sales_order_lines(id),
  line_no       int NOT NULL,
  item_id       uuid NOT NULL REFERENCES items(id),
  description   text NOT NULL,
  qty_delivered numeric(18,4) NOT NULL,
  unit_cost     numeric(18,4) NOT NULL DEFAULT 0,
  UNIQUE (dr_id, line_no)
);

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS dr_id uuid REFERENCES delivery_receipts(id);

-- Inventory reservations
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  so_id        uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  so_line_id   uuid NOT NULL REFERENCES sales_order_lines(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES items(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  qty_reserved numeric(18,4) NOT NULL,
  reserved_at  timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,
  status       varchar(20) NOT NULL DEFAULT 'active',
  UNIQUE (so_line_id)
);
CREATE INDEX IF NOT EXISTS idx_ir_item_wh ON inventory_reservations (item_id, warehouse_id);

-- AR credit memos
CREATE TABLE IF NOT EXISTS ar_credit_memos (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id           uuid REFERENCES branches(id),
  cm_no               varchar(30) NOT NULL,
  customer_id         uuid NOT NULL REFERENCES customers(id),
  original_invoice_id uuid REFERENCES sales_invoices(id),
  cm_date             date NOT NULL,
  reason              varchar(200),
  notes               text,
  subtotal            numeric(18,2) NOT NULL DEFAULT 0,
  vat_amount          numeric(18,2) NOT NULL DEFAULT 0,
  total               numeric(18,2) NOT NULL DEFAULT 0,
  amount_applied      numeric(18,2) NOT NULL DEFAULT 0,
  unapplied_amount    numeric(18,2) NOT NULL DEFAULT 0,
  status              varchar(20) NOT NULL DEFAULT 'draft',
  approved_by         uuid REFERENCES users(id),
  approved_at         timestamptz,
  cancelled_by        uuid REFERENCES users(id),
  cancelled_at        timestamptz,
  cancel_reason       text,
  je_id               uuid REFERENCES journal_entries(id),
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, cm_no)
);
CREATE OR REPLACE TRIGGER ar_credit_memos_updated
  BEFORE UPDATE ON ar_credit_memos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_cm_customer ON ar_credit_memos (customer_id);
CREATE INDEX IF NOT EXISTS idx_cm_status   ON ar_credit_memos (status);

CREATE TABLE IF NOT EXISTS ar_credit_memo_lines (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cm_id              uuid NOT NULL REFERENCES ar_credit_memos(id) ON DELETE CASCADE,
  line_no            int NOT NULL,
  item_id            uuid REFERENCES items(id),
  description        text NOT NULL,
  quantity           numeric(18,4) NOT NULL,
  unit_price         numeric(18,4) NOT NULL,
  vat_rate           numeric(5,2)  NOT NULL DEFAULT 12.00,
  line_subtotal      numeric(18,2) NOT NULL,
  line_vat           numeric(18,2) NOT NULL,
  line_total         numeric(18,2) NOT NULL,
  revenue_account_id uuid REFERENCES accounts(id),
  UNIQUE (cm_id, line_no)
);

CREATE TABLE IF NOT EXISTS ar_credit_memo_applications (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cm_id          uuid NOT NULL REFERENCES ar_credit_memos(id) ON DELETE CASCADE,
  invoice_id     uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  amount_applied numeric(18,2) NOT NULL CHECK (amount_applied > 0),
  applied_at     timestamptz NOT NULL DEFAULT now(),
  applied_by     uuid REFERENCES users(id),
  UNIQUE (cm_id, invoice_id)
);

-- Enhance customer_payments
ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS unapplied_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_advance       boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes            text,
  ADD COLUMN IF NOT EXISTS bank_ref         varchar(100),
  ADD COLUMN IF NOT EXISTS check_date       date,
  ADD COLUMN IF NOT EXISTS voided_by        uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS voided_at        timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason      text;

-- Permissions for AR/Sales module
INSERT INTO permissions (code, module, action, name) VALUES
  ('ar.customer.view',        'ar',    'view',    'View customers'),
  ('ar.customer.create',      'ar',    'create',  'Create customers'),
  ('ar.customer.update',      'ar',    'update',  'Update customers'),
  ('ar.invoice.void',         'ar',    'void',    'Void sales invoices'),
  ('ar.invoice.approve',      'ar',    'approve', 'Approve sales invoices'),
  ('ar.credit_memo.view',     'ar',    'view',    'View AR credit memos'),
  ('ar.credit_memo.create',   'ar',    'create',  'Create AR credit memos'),
  ('ar.credit_memo.approve',  'ar',    'approve', 'Approve AR credit memos'),
  ('ar.payment.view',         'ar',    'view',    'View customer payments'),
  ('ar.payment.void',         'ar',    'void',    'Void customer payments'),
  ('sales.order.view',        'sales', 'view',    'View sales orders'),
  ('sales.order.create',      'sales', 'create',  'Create sales orders'),
  ('sales.order.approve',     'sales', 'approve', 'Approve sales orders'),
  ('sales.order.cancel',      'sales', 'void',    'Cancel sales orders'),
  ('sales.delivery.view',     'sales', 'view',    'View delivery receipts'),
  ('sales.delivery.create',   'sales', 'create',  'Create delivery receipts'),
  ('sales.delivery.post',     'sales', 'post',    'Post delivery receipts')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'ar_clerk'
  AND p.code IN (
    'ar.customer.view','ar.customer.create',
    'ar.invoice.view','ar.invoice.create','ar.invoice.post',
    'ar.credit_memo.view','ar.credit_memo.create',
    'ar.payment.view','ar.payment.receive',
    'sales.order.view','sales.delivery.view','sales.delivery.create',
    'inventory.view','reports.view'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'finance_manager'
  AND p.code IN (
    'ar.customer.view','ar.customer.create','ar.customer.update',
    'ar.invoice.view','ar.invoice.create','ar.invoice.post',
    'ar.invoice.approve','ar.invoice.void',
    'ar.credit_memo.view','ar.credit_memo.create','ar.credit_memo.approve',
    'ar.payment.view','ar.payment.receive','ar.payment.void',
    'sales.order.view','sales.order.create','sales.order.approve','sales.order.cancel',
    'sales.delivery.view','sales.delivery.create','sales.delivery.post'
  )
ON CONFLICT DO NOTHING;

-- Document series for new doc types
INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
SELECT id, 'sales_order',      'SO-' || to_char(now(), 'YYYY') || '-', 1, 0 FROM companies
ON CONFLICT DO NOTHING;

INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
SELECT id, 'delivery_receipt', 'DR-' || to_char(now(), 'YYYY') || '-', 1, 0 FROM companies
ON CONFLICT DO NOTHING;

INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
SELECT id, 'credit_memo',      'CM-' || to_char(now(), 'YYYY') || '-', 1, 0 FROM companies
ON CONFLICT DO NOTHING;

INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
SELECT id, 'official_receipt', 'OR-' || to_char(now(), 'YYYY') || '-', 1, 0 FROM companies
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SEED: 001_demo_company.sql
-- ============================================================================
-- 001_demo_company.sql
-- Seed demo data for Perpet Pilipinas Corp.

-- Use a fixed UUID for the demo company so other seed files can reference it
INSERT INTO companies (id, code, name, legal_name, tin, rdo_code, address, base_currency)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'PPC',
  'Perpet Pilipinas Corp.',
  'Perpet Pilipinas Corporation',
  '000-000-000-000',           -- replace with real TIN
  '043',                        -- replace with real RDO code
  'Manila, Philippines',
  'PHP'
) ON CONFLICT (id) DO NOTHING;

-- Branches: head office + sample depot + sample retail station
INSERT INTO branches (id, company_id, code, name, branch_type, address) VALUES
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111111', 'HO',    'Head Office',          'office',          'Manila'),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111111', 'DEPOT-CAL', 'Calamba Fuel Depot', 'depot',           'Calamba, Laguna'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111111', 'STN-001',   'Perpet Station SLEX',  'retail_station', 'SLEX, Calamba')
ON CONFLICT DO NOTHING;

-- Fiscal periods for 2026
INSERT INTO fiscal_periods (company_id, year, period, start_date, end_date, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 2026,  1, '2026-01-01', '2026-01-31', 'closed'),
  ('11111111-1111-1111-1111-111111111111', 2026,  2, '2026-02-01', '2026-02-28', 'closed'),
  ('11111111-1111-1111-1111-111111111111', 2026,  3, '2026-03-01', '2026-03-31', 'closed'),
  ('11111111-1111-1111-1111-111111111111', 2026,  4, '2026-04-01', '2026-04-30', 'closed'),
  ('11111111-1111-1111-1111-111111111111', 2026,  5, '2026-05-01', '2026-05-31', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026,  6, '2026-06-01', '2026-06-30', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026,  7, '2026-07-01', '2026-07-31', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026,  8, '2026-08-01', '2026-08-31', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026,  9, '2026-09-01', '2026-09-30', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026, 10, '2026-10-01', '2026-10-31', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026, 11, '2026-11-01', '2026-11-30', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026, 12, '2026-12-01', '2026-12-31', 'open')
ON CONFLICT DO NOTHING;

-- BIR-controlled document series
INSERT INTO document_series (company_id, doc_type, prefix, start_number, end_number, current_number, bir_permit_no) VALUES
  ('11111111-1111-1111-1111-111111111111', 'sales_invoice',     'SI-2026-', 1, 9999, 0, 'CAS-2026-XXX-0000'),
  ('11111111-1111-1111-1111-111111111111', 'official_receipt',  'OR-2026-', 1, 9999, 0, 'CAS-2026-XXX-0000'),
  ('11111111-1111-1111-1111-111111111111', 'delivery_receipt',  'DR-2026-', 1, 9999, 0, 'CAS-2026-XXX-0000'),
  ('11111111-1111-1111-1111-111111111111', 'credit_memo',       'CM-2026-', 1, 999,  0, 'CAS-2026-XXX-0000'),
  ('11111111-1111-1111-1111-111111111111', 'journal_voucher',   'JV-2026-', 1, 9999, 0, NULL)
ON CONFLICT DO NOTHING;

-- Common PH tax codes
INSERT INTO tax_codes (company_id, code, name, tax_type, rate_pct, bir_atc_code) VALUES
  ('11111111-1111-1111-1111-111111111111', 'VAT12-OUT',  'Output VAT 12%',                'vat_output',  12.0000, NULL),
  ('11111111-1111-1111-1111-111111111111', 'VAT12-IN',   'Input VAT 12%',                 'vat_input',   12.0000, NULL),
  ('11111111-1111-1111-1111-111111111111', 'VAT0-OUT',   'Zero-rated sales',              'vat_output',   0.0000, NULL),
  ('11111111-1111-1111-1111-111111111111', 'EWT-1%',     'EWT 1% (goods)',                'ewt',          1.0000, 'WC158'),
  ('11111111-1111-1111-1111-111111111111', 'EWT-2%',     'EWT 2% (services)',             'ewt',          2.0000, 'WC160'),
  ('11111111-1111-1111-1111-111111111111', 'EWT-5%',     'EWT 5% (rentals)',              'ewt',          5.0000, 'WC100'),
  ('11111111-1111-1111-1111-111111111111', 'EWT-10%',    'EWT 10% (professional fees)',   'ewt',         10.0000, 'WC010')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SEED: 002_chart_of_accounts.sql
-- ============================================================================
-- 002_chart_of_accounts.sql
-- Chart of Accounts for a fuel wholesale/retail company.
-- Numbering follows a 4-digit hierarchical convention:
--   1xxx Assets, 2xxx Liabilities, 3xxx Equity, 4xxx Revenue, 5xxx Cost of sales, 6xxx Operating expenses

-- Note: company_id below is the demo company seeded in 001_demo_company.sql.

WITH ppc AS (SELECT '11111111-1111-1111-1111-111111111111'::uuid AS id)
INSERT INTO accounts (company_id, code, name, account_type, is_control)
SELECT ppc.id, x.code, x.name, x.account_type, x.is_control FROM ppc, (VALUES
  -- ASSETS (1000-1999)
  ('1010', 'Petty cash',                             'ASSET',     false),
  ('1020', 'Cash on hand - retail stations',         'ASSET',     false),
  ('1030', 'Cash in bank - BPI Current',             'ASSET',     false),
  ('1031', 'Cash in bank - BDO Current',             'ASSET',     false),
  ('1040', 'Cash in bank - USD account',             'ASSET',     false),
  ('1100', 'Accounts receivable - trade',            'ASSET',     true),
  ('1110', 'Accounts receivable - fleet accounts',   'ASSET',     true),
  ('1120', 'Accounts receivable - employees',        'ASSET',     false),
  ('1190', 'Allowance for doubtful accounts',        'ASSET',     false),
  ('1200', 'Inventory - diesel',                     'ASSET',     false),
  ('1210', 'Inventory - gasoline 91',                'ASSET',     false),
  ('1220', 'Inventory - gasoline 95',                'ASSET',     false),
  ('1230', 'Inventory - gasoline 97',                'ASSET',     false),
  ('1240', 'Inventory - kerosene',                   'ASSET',     false),
  ('1250', 'Inventory - LPG',                        'ASSET',     false),
  ('1290', 'Inventory - lubricants and additives',   'ASSET',     false),
  ('1295', 'Inventory in transit',                   'ASSET',     false),
  ('1300', 'Input VAT',                              'ASSET',     true),
  ('1310', 'Creditable withholding tax',             'ASSET',     false),
  ('1320', 'Excise tax - prepaid',                   'ASSET',     false),
  ('1400', 'Prepaid expenses',                       'ASSET',     false),
  ('1410', 'Advances to suppliers',                  'ASSET',     false),
  ('1500', 'PPE - Land',                             'ASSET',     false),
  ('1510', 'PPE - Buildings',                        'ASSET',     false),
  ('1520', 'PPE - Storage tanks',                    'ASSET',     false),
  ('1530', 'PPE - Pumps and dispensers',             'ASSET',     false),
  ('1540', 'PPE - Tankers and vehicles',             'ASSET',     false),
  ('1550', 'PPE - Furniture and equipment',          'ASSET',     false),
  ('1599', 'Accumulated depreciation',               'ASSET',     false),
  -- LIABILITIES (2000-2999)
  ('2010', 'Accounts payable - trade',               'LIABILITY', true),
  ('2020', 'Accounts payable - refineries',          'LIABILITY', true),
  ('2100', 'Accrued expenses',                       'LIABILITY', false),
  ('2110', 'Accrued salaries and wages',             'LIABILITY', false),
  ('2200', 'Output VAT',                             'LIABILITY', true),
  ('2210', 'VAT payable',                            'LIABILITY', false),
  ('2220', 'Excise tax payable',                     'LIABILITY', false),
  ('2230', 'EWT payable',                            'LIABILITY', false),
  ('2240', 'Withholding tax on compensation payable','LIABILITY', false),
  ('2250', 'SSS premiums payable',                   'LIABILITY', false),
  ('2260', 'PhilHealth premiums payable',            'LIABILITY', false),
  ('2270', 'Pag-IBIG premiums payable',              'LIABILITY', false),
  ('2300', 'Customer deposits',                      'LIABILITY', false),
  ('2310', 'Unearned revenue',                       'LIABILITY', false),
  ('2400', 'Short-term loans payable',               'LIABILITY', false),
  ('2500', 'Long-term loans payable',                'LIABILITY', false),
  -- EQUITY (3000-3999)
  ('3010', 'Share capital',                          'EQUITY',    false),
  ('3020', 'Retained earnings',                      'EQUITY',    false),
  ('3030', 'Current year earnings',                  'EQUITY',    false),
  -- REVENUE (4000-4999)
  ('4010', 'Sales - diesel',                         'REVENUE',   false),
  ('4020', 'Sales - gasoline 91',                    'REVENUE',   false),
  ('4030', 'Sales - gasoline 95',                    'REVENUE',   false),
  ('4040', 'Sales - gasoline 97',                    'REVENUE',   false),
  ('4050', 'Sales - kerosene',                       'REVENUE',   false),
  ('4060', 'Sales - LPG',                            'REVENUE',   false),
  ('4090', 'Sales - lubricants and additives',       'REVENUE',   false),
  ('4100', 'Sales discounts',                        'REVENUE',   false),
  ('4110', 'Sales returns and allowances',           'REVENUE',   false),
  ('4200', 'Other revenue - delivery charges',       'REVENUE',   false),
  ('4210', 'Interest income',                        'REVENUE',   false),
  ('4220', 'FX gain',                                'REVENUE',   false),
  -- COST OF SALES (5000-5499)
  ('5010', 'COGS - diesel',                          'EXPENSE',   false),
  ('5020', 'COGS - gasoline 91',                     'EXPENSE',   false),
  ('5030', 'COGS - gasoline 95',                     'EXPENSE',   false),
  ('5040', 'COGS - gasoline 97',                     'EXPENSE',   false),
  ('5050', 'COGS - kerosene',                        'EXPENSE',   false),
  ('5060', 'COGS - LPG',                             'EXPENSE',   false),
  ('5090', 'COGS - lubricants and additives',        'EXPENSE',   false),
  ('5200', 'Inventory variance - fuel losses',       'EXPENSE',   false),
  ('5210', 'Inventory variance - evaporation',       'EXPENSE',   false),
  ('5220', 'Freight in / hauling cost',              'EXPENSE',   false),
  -- OPERATING EXPENSES (6000-6999)
  ('6010', 'Salaries and wages',                     'EXPENSE',   false),
  ('6020', 'Employee benefits',                      'EXPENSE',   false),
  ('6030', 'SSS / PhilHealth / Pag-IBIG employer',   'EXPENSE',   false),
  ('6100', 'Rent - station and office',              'EXPENSE',   false),
  ('6110', 'Utilities - electricity',                'EXPENSE',   false),
  ('6120', 'Utilities - water and telco',            'EXPENSE',   false),
  ('6130', 'Repairs and maintenance',                'EXPENSE',   false),
  ('6140', 'Fuel and oil - vehicles',                'EXPENSE',   false),
  ('6150', 'Transportation and travel',              'EXPENSE',   false),
  ('6160', 'Office supplies',                        'EXPENSE',   false),
  ('6200', 'Depreciation expense',                   'EXPENSE',   false),
  ('6210', 'Insurance',                              'EXPENSE',   false),
  ('6220', 'Taxes and licenses',                     'EXPENSE',   false),
  ('6230', 'Professional fees',                      'EXPENSE',   false),
  ('6240', 'Bank charges',                           'EXPENSE',   false),
  ('6250', 'Marketing and advertising',              'EXPENSE',   false),
  ('6900', 'Miscellaneous expense',                  'EXPENSE',   false),
  ('6910', 'FX loss',                                'EXPENSE',   false)
) AS x(code, name, account_type, is_control)
ON CONFLICT (company_id, code) DO NOTHING;

-- ============================================================================
-- SEED: 003_demo_user.sql
-- ============================================================================
-- 003_demo_user.sql
-- Seed an initial superadmin user.
--
-- Email:    admin@perpet.com.ph
-- Password: Perpet2026!
--
-- The password_hash below is a bcrypt hash with cost 10. Change this immediately.
--
-- To regenerate:
--   node -e "console.log(require('bcryptjs').hashSync('Perpet2026!', 10))"

INSERT INTO users (id, email, password_hash, full_name, is_active, is_superadmin)
VALUES (
  '99999999-9999-9999-9999-999999999999',
  'admin@perpet.com.ph',
  '$2a$10$JU4exaCJSV7dLXA.Uq53pO1wMJFJxgE/sYPBWLzI8bf3eaL.7uH0y',  -- Perpet2026!
  'System Administrator',
  true,
  true
) ON CONFLICT (id) DO NOTHING;

-- Assign superadmin role for the demo company
INSERT INTO user_roles (user_id, role_id, company_id)
SELECT '99999999-9999-9999-9999-999999999999', r.id, '11111111-1111-1111-1111-111111111111'
FROM roles r WHERE r.code = 'superadmin'
ON CONFLICT DO NOTHING;

-- ================================================================
-- APP SETTINGS (global key-value, admin-managed)
-- ================================================================
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES ('dark_mode', 'false') ON CONFLICT DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('brand_theme', 'blue') ON CONFLICT DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('login_bg', '') ON CONFLICT DO NOTHING;
