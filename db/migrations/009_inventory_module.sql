-- 009_inventory_module.sql
-- Stock Adjustments, Stock Transfers, Stock Counts

-- ============================================================================
-- STOCK ADJUSTMENTS
-- ============================================================================

CREATE TABLE stock_adjustments (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  adj_no       varchar(30) NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  reason_code  varchar(30) NOT NULL
                 CHECK (reason_code IN ('DAMAGE','SPOILAGE','THEFT','FOUND','COUNT_CORRECTION','RECLASSIFICATION','OTHER')),
  notes        text,
  status       varchar(20) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','posted','voided')),
  created_by   uuid NOT NULL REFERENCES users(id),
  posted_by    uuid REFERENCES users(id),
  posted_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, adj_no)
);
CREATE TRIGGER stock_adjustments_updated
  BEFORE UPDATE ON stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_adjustment_lines (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  adj_id     uuid NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  line_no    int NOT NULL,
  item_id    uuid NOT NULL REFERENCES items(id),
  qty_change numeric(18,4) NOT NULL,   -- positive = found/gain, negative = loss
  unit_cost  numeric(18,4) NOT NULL,
  line_total numeric(18,4) NOT NULL,   -- abs(qty_change) * unit_cost
  notes      text,
  UNIQUE (adj_id, line_no)
);

CREATE INDEX idx_stock_adj_company_status ON stock_adjustments(company_id, status);
CREATE INDEX idx_stock_adj_warehouse ON stock_adjustments(warehouse_id);

-- ============================================================================
-- STOCK TRANSFERS
-- ============================================================================

CREATE TABLE stock_transfers (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  transfer_no        varchar(30) NOT NULL,
  from_warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  to_warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  status             varchar(20) NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','in_transit','received','cancelled')),
  notes              text,
  sent_at            timestamptz,
  received_at        timestamptz,
  sent_by            uuid REFERENCES users(id),
  received_by        uuid REFERENCES users(id),
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, transfer_no)
);
CREATE TRIGGER stock_transfers_updated
  BEFORE UPDATE ON stock_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_transfer_lines (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id        uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  line_no            int NOT NULL,
  item_id            uuid NOT NULL REFERENCES items(id),
  qty                numeric(18,4) NOT NULL,
  unit_cost_at_send  numeric(18,4),
  UNIQUE (transfer_id, line_no)
);

CREATE INDEX idx_stock_xfr_company_status ON stock_transfers(company_id, status);
CREATE INDEX idx_stock_xfr_from ON stock_transfers(from_warehouse_id);
CREATE INDEX idx_stock_xfr_to ON stock_transfers(to_warehouse_id);

-- ============================================================================
-- STOCK COUNTS
-- ============================================================================

CREATE TABLE stock_counts (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  count_no     varchar(30) NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  count_type   varchar(20) NOT NULL DEFAULT 'FULL'
                 CHECK (count_type IN ('FULL','CYCLE','SPOT')),
  status       varchar(20) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','in_progress','posted','voided')),
  notes        text,
  started_at   timestamptz,
  posted_at    timestamptz,
  started_by   uuid REFERENCES users(id),
  posted_by    uuid REFERENCES users(id),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, count_no)
);
CREATE TRIGGER stock_counts_updated
  BEFORE UPDATE ON stock_counts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_count_lines (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  count_id       uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES items(id),
  system_qty     numeric(18,4) NOT NULL DEFAULT 0,
  counted_qty    numeric(18,4) NOT NULL DEFAULT 0,
  variance       numeric(18,4) NOT NULL DEFAULT 0,    -- counted_qty - system_qty (updated on save)
  unit_cost      numeric(18,4) NOT NULL DEFAULT 0,
  variance_value numeric(18,4) NOT NULL DEFAULT 0,    -- variance * unit_cost
  UNIQUE (count_id, item_id)
);

CREATE INDEX idx_stock_count_company_status ON stock_counts(company_id, status);
CREATE INDEX idx_stock_count_warehouse ON stock_counts(warehouse_id);
