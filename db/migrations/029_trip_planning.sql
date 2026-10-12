-- 029_trip_planning.sql
-- Trip planning for Art Fresh chicken deliveries.
--
-- The dispatcher brings the day's sales orders (addresses + what is going) and
-- the trucks that are free; the planner allots orders to trucks and orders the
-- stops. A plan is kept as-solved (route_plans) so what the optimizer proposed
-- can always be compared with what the dispatcher actually sent out (trips).
--
-- Coordinates live on the master records (customers, warehouses) once someone
-- confirms the pin, because a geocoder's guess for a Philippine address is often
-- the barangay centroid, not the store. geocode_cache only remembers guesses so
-- the same address is not looked up twice.
--
-- 027 revoked default privileges from anon/authenticated, so the new tables are
-- not exposed through the Supabase API.

-- ── Coordinates and receiving hours on master data ──────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS latitude           numeric(9, 6),
  ADD COLUMN IF NOT EXISTS longitude          numeric(9, 6),
  ADD COLUMN IF NOT EXISTS location_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receiving_from     time,
  ADD COLUMN IF NOT EXISTS receiving_to       time,
  ADD COLUMN IF NOT EXISTS delivery_notes     text;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS latitude  numeric(9, 6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9, 6);

-- ── What a truck can carry ──────────────────────────────────────────────────
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS capacity_kg        numeric(10, 2),
  ADD COLUMN IF NOT EXISTS is_refrigerated    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_warehouse_id  uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_driver     varchar(100),
  ADD COLUMN IF NOT EXISTS default_helper     varchar(100),
  ADD COLUMN IF NOT EXISTS for_delivery       boolean NOT NULL DEFAULT false;

-- ── Geocoder memory ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geocode_cache (
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  address_key   text NOT NULL,                 -- lower-cased, whitespace-collapsed
  latitude      numeric(9, 6),
  longitude     numeric(9, 6),
  formatted     text,
  source        varchar(20) NOT NULL,          -- google | nominatim | manual
  precise       boolean NOT NULL DEFAULT false,-- street/building level, not area centroid
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, address_key)
);

-- ── A solved plan, kept exactly as the optimizer returned it ────────────────
CREATE TABLE IF NOT EXISTS route_plans (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  plan_no       varchar(30) NOT NULL,
  plan_date     date NOT NULL,
  depot_warehouse_id uuid REFERENCES warehouses(id),
  input         jsonb NOT NULL,                -- stops, trucks, options as submitted
  result        jsonb NOT NULL,                -- routes, unassigned, metrics
  ai_summary    text,
  status        varchar(20) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','confirmed','discarded')),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_by  uuid REFERENCES users(id),
  confirmed_at  timestamptz,
  UNIQUE (company_id, plan_no)
);
CREATE INDEX IF NOT EXISTS idx_route_plans_date ON route_plans (company_id, plan_date);

-- ── What was actually sent out ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  route_plan_id   uuid REFERENCES route_plans(id) ON DELETE SET NULL,
  trip_no         varchar(30) NOT NULL,
  trip_date       date NOT NULL,
  vehicle_id      uuid REFERENCES vehicles(id),
  plate_no        varchar(20) NOT NULL,
  driver_name     varchar(100),
  helper_name     varchar(100),
  depart_time     time,
  total_kg        numeric(12, 2) NOT NULL DEFAULT 0,
  stop_count      int NOT NULL DEFAULT 0,
  planned_km      numeric(10, 2),
  planned_minutes int,
  status          varchar(20) NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned','dispatched','completed','cancelled')),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, trip_no)
);
CREATE OR REPLACE TRIGGER trips_updated
  BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_trips_date ON trips (company_id, trip_date);

CREATE TABLE IF NOT EXISTS trip_stops (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id         uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seq             int NOT NULL,
  so_ref          varchar(60),                 -- SO number as given (ERP or pasted)
  sales_order_id  uuid REFERENCES sales_orders(id),
  customer_id     uuid REFERENCES customers(id),
  customer_name   varchar(200) NOT NULL,
  address         text,
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  kg              numeric(12, 2) NOT NULL DEFAULT 0,
  items           jsonb NOT NULL DEFAULT '[]', -- [{product, qty, uom, kg}]
  eta             time,
  window_from     time,
  window_to       time,
  remarks         text,
  status          varchar(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','delivered','failed','skipped')),
  UNIQUE (trip_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_trip_stops_so ON trip_stops (sales_order_id);

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO permissions (code, module, action, name) VALUES
  ('logistics.trip.view', 'logistics', 'view',   'View delivery trips'),
  ('logistics.trip.plan', 'logistics', 'create', 'Plan and confirm delivery trips')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.code = 'superadmin'
   AND p.code IN ('logistics.trip.view', 'logistics.trip.plan')
ON CONFLICT DO NOTHING;
