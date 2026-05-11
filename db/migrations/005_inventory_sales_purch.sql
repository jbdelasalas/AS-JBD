-- 005_inventory_sales_purch.sql
-- Inventory items, warehouses, stock movements, sales orders, purchase orders

-- Item categories
CREATE TABLE item_categories (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        varchar(20) NOT NULL,
  name        varchar(100) NOT NULL,
  parent_id   uuid REFERENCES item_categories(id),
  UNIQUE (company_id, code)
);

-- Items / SKUs
CREATE TABLE items (
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
CREATE TRIGGER items_updated BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_items_company_active ON items (company_id, is_active);
CREATE INDEX idx_items_fuel ON items (is_fuel) WHERE is_fuel = true;

-- Warehouses (depot, retail station tank farm, etc.)
CREATE TABLE warehouses (
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
CREATE TABLE stock_balances (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  qty_on_hand     numeric(18, 4) NOT NULL DEFAULT 0,
  avg_cost        numeric(18, 4) NOT NULL DEFAULT 0,
  last_movement_at timestamptz,
  UNIQUE (item_id, warehouse_id)
);

-- Stock movements (immutable transaction log)
CREATE TABLE stock_movements (
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
CREATE INDEX idx_sm_item_warehouse_date ON stock_movements (item_id, warehouse_id, movement_date DESC);
CREATE INDEX idx_sm_reference ON stock_movements (reference_type, reference_id);

-- ============================================================================
-- SALES ORDERS
-- ============================================================================

CREATE TABLE sales_orders (
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
CREATE TRIGGER sales_orders_updated BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sales_order_lines (
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

CREATE TABLE purchase_orders (
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
CREATE TRIGGER purchase_orders_updated BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_order_lines (
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
CREATE TABLE goods_receipts (
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

CREATE TABLE goods_receipt_lines (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  grn_id          uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_line_id      uuid NOT NULL REFERENCES purchase_order_lines(id),
  line_no         int NOT NULL,
  qty_received    numeric(18, 4) NOT NULL,
  unit_cost       numeric(18, 4) NOT NULL,
  UNIQUE (grn_id, line_no)
);

-- Add the FK from bills.po_id now that purchase_orders exists
ALTER TABLE bills ADD CONSTRAINT bills_po_id_fk FOREIGN KEY (po_id) REFERENCES purchase_orders(id);
