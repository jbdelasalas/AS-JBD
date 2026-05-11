-- 004_ar_ap.sql
-- Accounts receivable and accounts payable

-- ============================================================================
-- CUSTOMERS (AR)
-- ============================================================================

CREATE TABLE customers (
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
CREATE TRIGGER customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sales invoices
CREATE TABLE sales_invoices (
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
CREATE TRIGGER sales_invoices_updated BEFORE UPDATE ON sales_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_si_customer_date ON sales_invoices (customer_id, invoice_date DESC);
CREATE INDEX idx_si_status ON sales_invoices (status);

CREATE TABLE sales_invoice_lines (
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
CREATE TABLE customer_payments (
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
CREATE TRIGGER customer_payments_updated BEFORE UPDATE ON customer_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Payment-to-invoice application (one payment can settle many invoices)
CREATE TABLE payment_applications (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id      uuid NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  invoice_id      uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  amount_applied  numeric(18, 2) NOT NULL CHECK (amount_applied > 0)
);

-- ============================================================================
-- SUPPLIERS (AP)
-- ============================================================================

CREATE TABLE suppliers (
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
CREATE TRIGGER suppliers_updated BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Vendor bills
CREATE TABLE bills (
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
CREATE TRIGGER bills_updated BEFORE UPDATE ON bills FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_bills_supplier_date ON bills (supplier_id, bill_date DESC);
CREATE INDEX idx_bills_status ON bills (status);

CREATE TABLE bill_lines (
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
CREATE TABLE supplier_payments (
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
CREATE TRIGGER supplier_payments_updated BEFORE UPDATE ON supplier_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bill_payment_applications (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id      uuid NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  bill_id         uuid NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  amount_applied  numeric(18, 2) NOT NULL CHECK (amount_applied > 0)
);
