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

CREATE TABLE fuel_tanks (
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
CREATE TRIGGER fuel_tanks_updated BEFORE UPDATE ON fuel_tanks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tank dip / gauge readings (operator records physical level)
CREATE TABLE tank_readings (
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
CREATE INDEX idx_tank_readings_tank_time ON tank_readings (tank_id, reading_at DESC);

-- ============================================================================
-- FUEL DELIVERIES (inbound from refinery / supplier)
-- ============================================================================

CREATE TABLE fuel_deliveries (
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
CREATE TRIGGER fuel_deliveries_updated BEFORE UPDATE ON fuel_deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_fd_supplier_date ON fuel_deliveries (supplier_id, delivery_date DESC);
CREATE INDEX idx_fd_tank ON fuel_deliveries (tank_id);

COMMENT ON COLUMN fuel_deliveries.received_litres_15c IS 'Trade-recognised volume in litres at 15°C. This is the quantity that posts to inventory.';

-- ============================================================================
-- DISPENSING PUMPS (retail stations)
-- ============================================================================

CREATE TABLE pumps (
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
CREATE TABLE pump_readings (
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
CREATE INDEX idx_pump_readings_pump_time ON pump_readings (pump_id, reading_at DESC);

-- Retail shifts (operator on-duty period)
CREATE TABLE retail_shifts (
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
CREATE TRIGGER retail_shifts_updated BEFORE UPDATE ON retail_shifts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- FUEL RECONCILIATION (tank book vs measured)
-- ============================================================================

CREATE TABLE fuel_reconciliations (
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
CREATE INDEX idx_fuel_recon_tank_date ON fuel_reconciliations (tank_id, recon_date DESC);

COMMENT ON TABLE fuel_reconciliations IS 'Daily/shift reconciliation of book stock vs physically measured stock. Variances within tolerance go to Inventory Variance expense; variances outside tolerance require review and explanation.';
