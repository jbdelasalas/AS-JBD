-- 024_fuel_po_slips.sql
-- Employee gas consumption: Purchase Order (P.O.) Slips.
--
-- A slip is the paper chit an employee carries to the station. It is issued and
-- approved in-house (top half), then the station fills in the bottom half at the
-- pump: what was actually dispensed, the odometer, the OR number and the amount.
--
-- Lifecycle:
--   draft     -> issued    (approved & printed; employee holds the slip)
--   issued    -> redeemed  (station data captured; this is where cost is known)
--   any       -> cancelled/voided
--
-- Consumption analytics (L/100km, cost per km) come from consecutive redeemed
-- slips on the same vehicle, using the odometer reading.

-- ============================================================================
-- VEHICLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicles (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plate_no        varchar(20) NOT NULL,
  description     varchar(150),                 -- e.g. "Isuzu Elf - delivery"
  vehicle_type    varchar(30),                  -- truck | van | motorcycle | car | genset | other
  default_product varchar(20),                  -- diesel | gasoline | premium | kerosene
  tank_capacity_l numeric(10, 2),               -- used to sanity-check issued litres
  assigned_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  cost_center_id  uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  expense_account_id uuid REFERENCES accounts(id),  -- defaults to 6140 Fuel and oil - vehicles
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, plate_no)
);

CREATE OR REPLACE TRIGGER vehicles_updated
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_vehicles_company ON vehicles (company_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_employee ON vehicles (assigned_employee_id);

-- ============================================================================
-- FUEL P.O. SLIPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS fuel_po_slips (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id         uuid REFERENCES branches(id),

  -- Pre-printed booklet number on the physical pad (the "No. 6616" on the slip).
  -- Unique per company so the same chit cannot be captured twice.
  slip_no           varchar(30) NOT NULL,
  -- Which entity the booklet belongs to: the tick-boxes across the slip header.
  entity_code       varchar(20) NOT NULL DEFAULT 'ARTFRESH'
                      CHECK (entity_code IN ('PPC','ARTPRO','ARTFRESH','JHTC')),

  -- ── Issued to (top half, filled in by HR/Admin) ──
  employee_id       uuid REFERENCES employees(id),
  issued_to_name    varchar(150) NOT NULL,      -- kept as text: slips are sometimes
                                                 -- issued to non-employees (drivers, contractors)
  position_dept     varchar(150),               -- "Position / Dept."
  vehicle_id        uuid REFERENCES vehicles(id),
  plate_no          varchar(20),                -- snapshot; slip may name a rented unit
  product           varchar(20) NOT NULL        -- "Product"
                      CHECK (product IN ('diesel','gasoline','premium','kerosene','other')),
  quantity_litres   numeric(12, 2),             -- "Quantity in Liters" (the authorised cap)
  issue_date        date NOT NULL DEFAULT CURRENT_DATE,
  purpose           text,

  -- ── To be accomplished by station (bottom half) ──
  station_name      varchar(150),               -- "Company / Station"
  gas_up_at         timestamptz,                -- "Date / Time of Gas-up"
  odometer_km       numeric(12, 1),             -- "Milage / KM Reading"
  actual_litres     numeric(12, 2),             -- "Actual Gas-Up Liters"
  official_receipt_no varchar(50),              -- "Official Receipt #"
  catered_by        varchar(150),               -- forecourt team member name
  amount            numeric(18, 2),             -- "Amount in Php."
  unit_price        numeric(18, 4),             -- derived: amount / actual_litres

  -- ── Derived consumption (computed on redeem from the prior slip) ──
  km_travelled      numeric(12, 1),             -- odometer_km - previous odometer_km
  km_per_litre      numeric(10, 3),

  status            varchar(20) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','issued','redeemed','cancelled')),

  approved_by       uuid REFERENCES users(id),  -- "Issued and approved by" (HR & Admin)
  approved_at       timestamptz,
  redeemed_by       uuid REFERENCES users(id),  -- who captured the station data
  redeemed_at       timestamptz,
  cancelled_by      uuid REFERENCES users(id),
  cancelled_at      timestamptz,
  cancel_reason     text,

  -- Accounting links (populated when the slip is expensed / billed)
  expense_account_id uuid REFERENCES accounts(id),
  bill_id           uuid REFERENCES bills(id),
  er_id             uuid REFERENCES employee_expense_reports(id),
  je_id             uuid REFERENCES journal_entries(id),

  notes             text,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, slip_no)
);

CREATE OR REPLACE TRIGGER fuel_po_slips_updated
  BEFORE UPDATE ON fuel_po_slips
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_fps_company_date ON fuel_po_slips (company_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_fps_employee     ON fuel_po_slips (employee_id);
CREATE INDEX IF NOT EXISTS idx_fps_vehicle_odo  ON fuel_po_slips (vehicle_id, odometer_km DESC);
CREATE INDEX IF NOT EXISTS idx_fps_status       ON fuel_po_slips (status);

COMMENT ON TABLE fuel_po_slips IS
  'Employee gas consumption slips. Top half is issued/approved in-house; bottom half is accomplished by the fuel station at the pump.';
COMMENT ON COLUMN fuel_po_slips.quantity_litres IS
  'Authorised litres printed on the slip — the cap. Compare against actual_litres on redeem.';
COMMENT ON COLUMN fuel_po_slips.km_per_litre IS
  'Derived on redeem from the previous redeemed slip for the same vehicle. NULL when there is no prior odometer reading.';

-- Document series so slips can also be auto-numbered when a company does not
-- use pre-printed booklets.
INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
SELECT id, 'fuel_po_slip', 'PO-', 1, 0
FROM companies
WHERE NOT EXISTS (
  SELECT 1 FROM document_series ds
   WHERE ds.company_id = companies.id AND ds.doc_type = 'fuel_po_slip'
);
