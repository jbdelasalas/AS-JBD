-- 008_ar_module_complete.sql
-- Complete AR module: approval workflows, delivery receipts,
-- inventory reservations, credit memos, enhanced collections

-- ================================================================
-- ENHANCE EXISTING SALES ORDERS
-- ================================================================
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
-- Status lifecycle: draft | pending_approval | approved | partially_delivered | fully_delivered | closed | cancelled
-- (varchar column, enforced by service)

ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS qty_reserved   numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost      numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_pct   numeric(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_subtotal  numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_vat       numeric(18,2) NOT NULL DEFAULT 0;

-- ================================================================
-- ENHANCE EXISTING SALES INVOICES
-- ================================================================
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
-- Status lifecycle: draft | open | partially_paid | paid | overdue | cancelled
-- (extends existing draft|posted|partial|paid|voided — service normalises)

-- ================================================================
-- DELIVERY RECEIPTS
-- ================================================================
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
  status        varchar(20) NOT NULL DEFAULT 'draft',  -- draft | posted | cancelled
  posted_at     timestamptz,
  posted_by     uuid REFERENCES users(id),
  je_id         uuid REFERENCES journal_entries(id),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, dr_no)
);
CREATE TRIGGER delivery_receipts_updated
  BEFORE UPDATE ON delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_dr_so     ON delivery_receipts (so_id);
CREATE INDEX idx_dr_status ON delivery_receipts (status);

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

-- Link invoices back to delivery receipts
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS dr_id uuid REFERENCES delivery_receipts(id);

-- ================================================================
-- INVENTORY RESERVATIONS
-- ================================================================
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  so_id        uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  so_line_id   uuid NOT NULL REFERENCES sales_order_lines(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES items(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  qty_reserved numeric(18,4) NOT NULL,
  reserved_at  timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,
  status       varchar(20) NOT NULL DEFAULT 'active',  -- active | released | consumed
  UNIQUE (so_line_id)
);
CREATE INDEX idx_ir_item_wh ON inventory_reservations (item_id, warehouse_id);

-- ================================================================
-- AR CREDIT MEMOS
-- ================================================================
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
  -- draft | pending_approval | approved | applied | cancelled
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
CREATE TRIGGER ar_credit_memos_updated
  BEFORE UPDATE ON ar_credit_memos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_cm_customer ON ar_credit_memos (customer_id);
CREATE INDEX idx_cm_status   ON ar_credit_memos (status);

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

-- ================================================================
-- ENHANCE EXISTING CUSTOMER PAYMENTS
-- ================================================================
ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS unapplied_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_advance       boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes            text,
  ADD COLUMN IF NOT EXISTS bank_ref         varchar(100),
  ADD COLUMN IF NOT EXISTS check_date       date,
  ADD COLUMN IF NOT EXISTS voided_by        uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS voided_at        timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason      text;

-- ================================================================
-- PERMISSIONS FOR AR / SALES MODULE
-- ================================================================
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

-- AR clerk permissions
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

-- Finance manager full AR/Sales access
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

-- ================================================================
-- DOCUMENT SERIES FOR NEW DOCUMENT TYPES
-- ================================================================
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
