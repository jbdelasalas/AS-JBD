-- 010_admin_module.sql
-- Administration Module additions.
-- Extends existing tables and adds new ones.
-- DO NOT recreate: users, roles, permissions, role_permissions, user_roles,
--   companies, branches, warehouses, accounts, tax_codes, fiscal_periods,
--   currencies, document_series, audit_log — they already exist.

-- ============================================================================
-- EXTEND EXISTING TABLES
-- ============================================================================

-- Extend companies with admin-required fields
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS trade_name          varchar(200),
  ADD COLUMN IF NOT EXISTS vat_status          varchar(20)
    CHECK (vat_status IN ('VAT_REGISTERED','NON_VAT','EXEMPT')),
  ADD COLUMN IF NOT EXISTS rdo_code            varchar(10),
  ADD COLUMN IF NOT EXISTS business_style      text,
  ADD COLUMN IF NOT EXISTS registered_address  text,
  ADD COLUMN IF NOT EXISTS registration_date   date,
  ADD COLUMN IF NOT EXISTS books_start_date    date,
  ADD COLUMN IF NOT EXISTS accounting_method   varchar(10)
    CHECK (accounting_method IN ('ACCRUAL','CASH')) DEFAULT 'ACCRUAL',
  ADD COLUMN IF NOT EXISTS fiscal_year_start_month int DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS created_by          uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by          uuid REFERENCES users(id);

-- Extend branches with BIR fields
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS bir_atp_number    varchar(50),
  ADD COLUMN IF NOT EXISTS bir_atp_valid_from date,
  ADD COLUMN IF NOT EXISTS bir_atp_valid_to   date,
  ADD COLUMN IF NOT EXISTS ptu_number         varchar(50),
  ADD COLUMN IF NOT EXISTS man_number         varchar(50),
  ADD COLUMN IF NOT EXISTS manager_user_id    uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_by         uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by         uuid REFERENCES users(id);

-- Extend users with missing admin fields
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id);

-- Extend accounts (chart of accounts) with statement_section
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS statement_section varchar(30),
  ADD COLUMN IF NOT EXISTS normal_side       varchar(3) CHECK (normal_side IN ('DR','CR')),
  ADD COLUMN IF NOT EXISTS created_by        uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by        uuid REFERENCES users(id);

-- ============================================================================
-- USER PERMISSION OVERRIDES
-- Per-user additive / subtractive permission grants (beyond their role).
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    uuid REFERENCES companies(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  is_granted    boolean NOT NULL,  -- true = grant even if role lacks; false = revoke even if role has
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id),
  UNIQUE (user_id, company_id, permission_id)
);
CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_user ON user_permission_overrides(user_id, company_id);

-- ============================================================================
-- COST CENTERS / DEPARTMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS cost_centers (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code          varchar(20) NOT NULL,
  name          varchar(100) NOT NULL,
  parent_id     uuid REFERENCES cost_centers(id),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id),
  updated_by    uuid REFERENCES users(id),
  UNIQUE (company_id, code)
);
CREATE TRIGGER cost_centers_updated BEFORE UPDATE ON cost_centers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- FISCAL YEARS (wrapper around existing fiscal_periods)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fiscal_years (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year          int NOT NULL,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  is_closed     boolean NOT NULL DEFAULT false,
  closed_at     timestamptz,
  closed_by     uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, year)
);

-- Link existing fiscal_periods to fiscal_years
ALTER TABLE fiscal_periods
  ADD COLUMN IF NOT EXISTS fiscal_year_id uuid REFERENCES fiscal_years(id),
  ADD COLUMN IF NOT EXISTS locked_at      timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by      uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by     uuid REFERENCES users(id);

-- ============================================================================
-- UNITS OF MEASURE
-- ============================================================================
CREATE TABLE IF NOT EXISTS uoms (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code          varchar(20) NOT NULL,
  name          varchar(50) NOT NULL,
  type          varchar(10) NOT NULL CHECK (type IN ('COUNT','WEIGHT','VOLUME','LENGTH','TIME')),
  is_base       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE TRIGGER uoms_updated BEFORE UPDATE ON uoms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS uom_conversions (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_uom_id  uuid NOT NULL REFERENCES uoms(id) ON DELETE CASCADE,
  to_uom_id    uuid NOT NULL REFERENCES uoms(id) ON DELETE CASCADE,
  factor       numeric(18,8) NOT NULL,  -- from_uom * factor = to_uom
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, from_uom_id, to_uom_id),
  CHECK (from_uom_id <> to_uom_id)
);

-- ============================================================================
-- PAYMENT METHODS (named methods that resolve to a GL account)
-- ============================================================================
CREATE TABLE IF NOT EXISTS payment_methods (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                varchar(20) NOT NULL,
  name                varchar(100) NOT NULL,
  account_id          uuid REFERENCES accounts(id),
  requires_reference  boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE TRIGGER payment_methods_updated BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- BANKS & BANK ACCOUNTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS banks (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_name             varchar(100) NOT NULL,
  account_number_last4  char(4),
  account_type          varchar(30),
  gl_account_id         uuid REFERENCES accounts(id),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER banks_updated BEFORE UPDATE ON banks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- APPROVAL WORKFLOWS
-- ============================================================================
CREATE TABLE IF NOT EXISTS approval_workflows (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          varchar(100) NOT NULL,
  document_type varchar(30) NOT NULL,  -- INV, PO, BILL, JE, ADJ, etc.
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id)
);
CREATE TRIGGER approval_workflows_updated BEFORE UPDATE ON approval_workflows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS approval_workflow_steps (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id      uuid NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
  step_no          int NOT NULL,
  approver_type    varchar(20) NOT NULL CHECK (approver_type IN ('ROLE','USER','BRANCH_MANAGER')),
  approver_ref     uuid,         -- role_id or user_id depending on approver_type
  threshold_amount numeric(18,4),  -- null = always routes here; set to route by amount
  sla_hours        int,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, step_no)
);

-- Approval state per document
CREATE TABLE IF NOT EXISTS document_approvals (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_type   varchar(30) NOT NULL,
  document_id     uuid NOT NULL,
  workflow_id     uuid REFERENCES approval_workflows(id),
  status          varchar(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','POSTED')),
  current_step_no int,
  submitted_at    timestamptz,
  submitted_by    uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id)
);
CREATE TRIGGER document_approvals_updated BEFORE UPDATE ON document_approvals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Individual approval decisions (append-only — never update a decision)
CREATE TABLE IF NOT EXISTS approval_records (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  approval_id uuid NOT NULL REFERENCES document_approvals(id) ON DELETE CASCADE,
  step_no     int NOT NULL,
  approver_id uuid REFERENCES users(id),
  decision    varchar(10) NOT NULL DEFAULT 'PENDING'
    CHECK (decision IN ('PENDING','APPROVED','REJECTED')),
  comments    text,
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- BIR SETUP (per-branch extended BIR registration details)
-- ============================================================================
CREATE TABLE IF NOT EXISTS bir_setup (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id            uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  atp_number           varchar(50),
  atp_valid_from       date,
  atp_valid_to         date,
  ptu_number           varchar(50),
  man_number           varchar(50),
  signatory_name       varchar(200),
  signatory_tin        varchar(20),
  signatory_position   varchar(100),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);
CREATE TRIGGER bir_setup_updated BEFORE UPDATE ON bir_setup
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- APP SETTINGS (extended — replaces simple key-value with scoped settings)
-- The simple app_settings table was already created via migration endpoint.
-- This adds scoped settings alongside it.
-- ============================================================================
CREATE TABLE IF NOT EXISTS app_settings_scoped (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         text NOT NULL,
  value       text,
  scope       varchar(10) NOT NULL CHECK (scope IN ('GLOBAL','COMPANY','BRANCH','USER')),
  scope_id    uuid,   -- company_id / branch_id / user_id depending on scope
  data_type   varchar(10) NOT NULL DEFAULT 'STRING'
    CHECK (data_type IN ('STRING','INT','DECIMAL','BOOLEAN','JSON')),
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, scope, scope_id)
);
CREATE TRIGGER app_settings_scoped_updated BEFORE UPDATE ON app_settings_scoped
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- FEATURE FLAGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS feature_flags (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               text UNIQUE NOT NULL,
  enabled            boolean NOT NULL DEFAULT false,
  rollout_companies  uuid[] NOT NULL DEFAULT '{}',
  rollout_users      uuid[] NOT NULL DEFAULT '{}',
  description        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER feature_flags_updated BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed known flags so they appear in the admin UI on a fresh database.
-- Idempotent: re-running never clobbers an admin's chosen enabled state.
INSERT INTO feature_flags (name, enabled, description) VALUES
  ('allow_negative_inventory', false, 'When enabled, posting transactions that reduce stock below zero is permitted.')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_cost_centers_company ON cost_centers(company_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_company ON fiscal_years(company_id);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_company ON approval_workflows(company_id, document_type);
CREATE INDEX IF NOT EXISTS idx_document_approvals_doc ON document_approvals(document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_document_approvals_company ON document_approvals(company_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_records_approval ON approval_records(approval_id);
CREATE INDEX IF NOT EXISTS idx_uoms_company ON uoms(company_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_company ON payment_methods(company_id);
