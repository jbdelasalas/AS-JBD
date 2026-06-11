-- 023_customer_portal.sql
-- Customer Portal: customers log in (same auth), place orders at their
-- contracted prices, and track each order through a 7-stage delivery workflow.
-- Ported from the Google Apps Script "AFCC Customer Portal v2.4".
--
-- This migration is purely ADDITIVE and IDEMPOTENT. It does not modify or
-- delete any existing rows, and is safe to re-run.

-- ============================================================================
-- 1. Link a portal user to exactly one customer
-- ============================================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS customer_id    uuid REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS is_portal_user boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_customer ON users (customer_id) WHERE customer_id IS NOT NULL;

-- ============================================================================
-- 2. Extend sales_orders with the 7-stage portal tracking workflow
--    portal_status is kept SEPARATE from the accounting `status` column so AR
--    logic is untouched.
--    Stages: Pending | Approved | Allocated | Truck Assigned |
--            Ready to Dispatch | Out for Delivery | Delivered |
--            Cancelled | Rejected
-- ============================================================================
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS portal_status      varchar(30),                      -- null = not a portal order
  ADD COLUMN IF NOT EXISTS priority           varchar(10) NOT NULL DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS is_portal_order    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allocated_by       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS allocated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS truck_assigned_by  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS truck_assigned_at  timestamptz,
  ADD COLUMN IF NOT EXISTS truck_no           varchar(40),
  ADD COLUMN IF NOT EXISTS driver             varchar(120),
  ADD COLUMN IF NOT EXISTS loaded_by          uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS loaded_at          timestamptz,
  ADD COLUMN IF NOT EXISTS dr_number          varchar(40),
  ADD COLUMN IF NOT EXISTS dr_photo_url       text,
  ADD COLUMN IF NOT EXISTS dispatched_by      uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS dispatched_at      timestamptz,
  ADD COLUMN IF NOT EXISTS gps_url            text,
  ADD COLUMN IF NOT EXISTS delivered_at       timestamptz;

CREATE INDEX IF NOT EXISTS idx_sales_orders_portal
  ON sales_orders (company_id, customer_id, portal_status)
  WHERE is_portal_order = true;

-- ============================================================================
-- 3. Per-customer contracted price list (mirrors the Apps Script Price_List)
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_price_list (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES items(id)     ON DELETE CASCADE,
  custom_price   numeric(18, 4) NOT NULL,
  effective_date date,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, item_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'customer_price_list_updated') THEN
    CREATE TRIGGER customer_price_list_updated
      BEFORE UPDATE ON customer_price_list
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_customer_price_list_lookup
  ON customer_price_list (company_id, customer_id, item_id);

-- ============================================================================
-- 4. RBAC: a 'customer' role + portal permissions
-- ============================================================================
INSERT INTO roles (code, name, description) VALUES
  ('customer', 'Portal customer', 'Self-service customer: place and track orders')
ON CONFLICT DO NOTHING;

INSERT INTO permissions (code, module, action, name) VALUES
  ('portal.order.view',   'portal', 'view',   'View own orders in the customer portal'),
  ('portal.order.create', 'portal', 'create', 'Place orders in the customer portal')
ON CONFLICT DO NOTHING;

-- Grant portal permissions to the customer role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'customer'
  AND p.code IN ('portal.order.view', 'portal.order.create')
ON CONFLICT DO NOTHING;

-- Superadmin already gets every permission via the cross-join grant in 002,
-- but re-assert here so portal.* is granted even on pre-existing databases.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'superadmin' AND p.module = 'portal'
ON CONFLICT DO NOTHING;
