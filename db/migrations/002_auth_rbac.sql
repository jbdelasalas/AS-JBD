-- 002_auth_rbac.sql
-- Users, roles, permissions

CREATE TABLE users (
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
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh tokens for JWT rotation
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  varchar(200) NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);

-- Roles (system-wide role definitions)
CREATE TABLE roles (
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
CREATE TABLE permissions (
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
CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- User-role assignment (scoped per company)
-- We use a surrogate id and unique indexes because Postgres doesn't allow
-- expressions (like COALESCE for nullable columns) inside a PRIMARY KEY.
CREATE TABLE user_roles (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,  -- NULL = applies to all companies
  branch_id   uuid REFERENCES branches(id) ON DELETE CASCADE,   -- NULL = applies to all branches
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Prevent duplicate assignment whether company_id is set or null
CREATE UNIQUE INDEX user_roles_unique_with_company
  ON user_roles (user_id, role_id, company_id)
  WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX user_roles_unique_no_company
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
