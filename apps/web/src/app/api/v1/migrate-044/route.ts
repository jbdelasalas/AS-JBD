export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// 044 — Fuel module foundation tables + vertical-module enable/disable flags.
//
// Two parts:
//   1. Create the fuel foundation tables idempotently. The canonical schema lives
//      in db/migrations/006_fuel.sql, but that file was never wired into the
//      runtime migration path (run-migrations / supabase schema), so the tables
//      don't exist in the live DB. This brings up the tables the Fuel foundation
//      uses: fuel_tanks, tank_readings, fuel_deliveries. (Pumps / shifts /
//      reconciliation come with the next pass.)
//   2. Register one feature flag per vertical module so a superadmin can switch an
//      industry module off for a deployment that doesn't use it. These default to
//      ENABLED (the modules ship visible) — turning a flag OFF hides the nav group.

const MODULE_FLAGS: Array<{ name: string; description: string }> = [
  { name: 'poultry',    description: 'Poultry Operations — grow cycles, tally sheets, conversions, sales tallies. Turn OFF to hide for non-poultry deployments.' },
  { name: 'restaurant', description: 'Restaurant module nav shortcuts. Turn OFF to hide for non-restaurant deployments.' },
  { name: 'fuel',       description: 'Fuel distribution & retailing — tanks, dip readings, deliveries, pump shifts, reconciliation.' },
];

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];

  // ── Part 1: fuel foundation tables (idempotent) ───────────────────────────
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS fuel_tanks (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        tank_no         varchar(20) NOT NULL,
        tank_name       varchar(100),
        item_id         uuid NOT NULL REFERENCES items(id),
        capacity_litres numeric(18, 2) NOT NULL,
        safe_fill_litres numeric(18, 2),
        dead_stock_litres numeric(18, 2) NOT NULL DEFAULT 0,
        is_active       boolean NOT NULL DEFAULT true,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, tank_no)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tank_readings (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tank_id         uuid NOT NULL REFERENCES fuel_tanks(id) ON DELETE CASCADE,
        reading_at      timestamptz NOT NULL DEFAULT now(),
        reading_type    varchar(20) NOT NULL DEFAULT 'manual',
        dip_cm          numeric(10, 2),
        observed_litres numeric(18, 2) NOT NULL,
        observed_temp_c numeric(6, 2),
        density_kg_l    numeric(10, 4),
        litres_at_15c   numeric(18, 2),
        water_cm        numeric(10, 2) DEFAULT 0,
        notes           text,
        recorded_by     uuid NOT NULL REFERENCES users(id),
        created_at      timestamptz NOT NULL DEFAULT now()
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tank_readings_tank_time ON tank_readings (tank_id, reading_at DESC)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fuel_deliveries (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        delivery_no       varchar(30) NOT NULL,
        supplier_id       uuid NOT NULL REFERENCES suppliers(id),
        po_id             uuid REFERENCES purchase_orders(id),
        warehouse_id      uuid NOT NULL REFERENCES warehouses(id),
        tank_id           uuid NOT NULL REFERENCES fuel_tanks(id),
        item_id           uuid NOT NULL REFERENCES items(id),
        delivery_date     timestamptz NOT NULL,
        truck_plate_no    varchar(20),
        driver_name       varchar(100),
        bol_no            varchar(50),
        loaded_litres_15c numeric(18, 2),
        loaded_litres_obs numeric(18, 2),
        loaded_temp_c     numeric(6, 2),
        loaded_density    numeric(10, 4),
        received_litres_15c numeric(18, 2) NOT NULL,
        received_litres_obs numeric(18, 2) NOT NULL,
        received_temp_c   numeric(6, 2),
        received_density  numeric(10, 4),
        variance_litres   numeric(18, 2) GENERATED ALWAYS AS (received_litres_15c - COALESCE(loaded_litres_15c, received_litres_15c)) STORED,
        tank_reading_before_id uuid REFERENCES tank_readings(id),
        tank_reading_after_id  uuid REFERENCES tank_readings(id),
        unit_cost         numeric(18, 4),
        excise_tax_amount numeric(18, 2) NOT NULL DEFAULT 0,
        vat_amount        numeric(18, 2) NOT NULL DEFAULT 0,
        total_cost        numeric(18, 2),
        status            varchar(20) NOT NULL DEFAULT 'draft',
        posted_at         timestamptz,
        bill_id           uuid REFERENCES bills(id),
        je_id             uuid REFERENCES journal_entries(id),
        notes             text,
        created_by        uuid NOT NULL REFERENCES users(id),
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, delivery_no)
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fd_supplier_date ON fuel_deliveries (supplier_id, delivery_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fd_tank ON fuel_deliveries (tank_id)`);

    // updated_at triggers (guarded — set_updated_at() is created by 001_init)
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='fuel_tanks_updated') THEN
        CREATE TRIGGER fuel_tanks_updated BEFORE UPDATE ON fuel_tanks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='fuel_deliveries_updated') THEN
        CREATE TRIGGER fuel_deliveries_updated BEFORE UPDATE ON fuel_deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
    END $$`);

    await client.query('COMMIT');
    results.push('044.1 fuel foundation tables: ok');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    results.push(`044.1 fuel foundation tables FAILED: ${(e as Error).message}`);
  } finally {
    client.release();
  }

  // ── Part 2: vertical-module feature flags (default ON) ────────────────────
  for (const f of MODULE_FLAGS) {
    try {
      await query(
        `INSERT INTO feature_flags (name, enabled, description)
         VALUES ($1, true, $2)
         ON CONFLICT (name) DO NOTHING`,
        [f.name, f.description],
      );
      results.push(`044.2 ${f.name} feature flag: ok`);
    } catch (e) {
      results.push(`044.2 ${f.name} feature flag FAILED: ${(e as Error).message}`);
    }
  }

  return ok({ results });
}
