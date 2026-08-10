export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// Creates the employee gas-consumption tables (vehicles + fuel_po_slips).
// Runs against BOTH the public and sandbox schemas, since the app serves either
// depending on the x-db-mode header. Idempotent.
const STATEMENTS: [string, string][] = [
  ['vehicles', `
    CREATE TABLE IF NOT EXISTS %SCHEMA%.vehicles (
      id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id      uuid NOT NULL REFERENCES %SCHEMA%.companies(id) ON DELETE CASCADE,
      plate_no        varchar(20) NOT NULL,
      description     varchar(150),
      vehicle_type    varchar(30),
      default_product varchar(20),
      tank_capacity_l numeric(10, 2),
      assigned_employee_id uuid REFERENCES %SCHEMA%.employees(id) ON DELETE SET NULL,
      department_id   uuid REFERENCES %SCHEMA%.departments(id) ON DELETE SET NULL,
      cost_center_id  uuid REFERENCES %SCHEMA%.cost_centers(id) ON DELETE SET NULL,
      expense_account_id uuid REFERENCES %SCHEMA%.accounts(id),
      is_active       boolean NOT NULL DEFAULT true,
      notes           text,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, plate_no)
    )`],
  ['fuel_po_slips', `
    CREATE TABLE IF NOT EXISTS %SCHEMA%.fuel_po_slips (
      id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id        uuid NOT NULL REFERENCES %SCHEMA%.companies(id) ON DELETE RESTRICT,
      branch_id         uuid REFERENCES %SCHEMA%.branches(id),
      slip_no           varchar(30) NOT NULL,
      entity_code       varchar(20) NOT NULL DEFAULT 'ARTFRESH'
                          CHECK (entity_code IN ('PPC','ARTPRO','ARTFRESH','JHTC')),
      employee_id       uuid REFERENCES %SCHEMA%.employees(id),
      issued_to_name    varchar(150) NOT NULL,
      position_dept     varchar(150),
      vehicle_id        uuid REFERENCES %SCHEMA%.vehicles(id),
      plate_no          varchar(20),
      product           varchar(20) NOT NULL
                          CHECK (product IN ('diesel','gasoline','premium','kerosene','other')),
      quantity_litres   numeric(12, 2),
      issue_date        date NOT NULL DEFAULT CURRENT_DATE,
      purpose           text,
      station_name      varchar(150),
      gas_up_at         timestamptz,
      odometer_km       numeric(12, 1),
      actual_litres     numeric(12, 2),
      official_receipt_no varchar(50),
      catered_by        varchar(150),
      amount            numeric(18, 2),
      unit_price        numeric(18, 4),
      km_travelled      numeric(12, 1),
      km_per_litre      numeric(10, 3),
      status            varchar(20) NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','issued','redeemed','cancelled')),
      approved_by       uuid REFERENCES %SCHEMA%.users(id),
      approved_at       timestamptz,
      redeemed_by       uuid REFERENCES %SCHEMA%.users(id),
      redeemed_at       timestamptz,
      cancelled_by      uuid REFERENCES %SCHEMA%.users(id),
      cancelled_at      timestamptz,
      cancel_reason     text,
      expense_account_id uuid REFERENCES %SCHEMA%.accounts(id),
      bill_id           uuid REFERENCES %SCHEMA%.bills(id),
      er_id             uuid REFERENCES %SCHEMA%.employee_expense_reports(id),
      je_id             uuid REFERENCES %SCHEMA%.journal_entries(id),
      notes             text,
      created_by        uuid NOT NULL REFERENCES %SCHEMA%.users(id),
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, slip_no)
    )`],
  ['idx_vehicles_company',  `CREATE INDEX IF NOT EXISTS idx_vehicles_company  ON %SCHEMA%.vehicles (company_id)`],
  ['idx_vehicles_employee', `CREATE INDEX IF NOT EXISTS idx_vehicles_employee ON %SCHEMA%.vehicles (assigned_employee_id)`],
  ['idx_fps_company_date',  `CREATE INDEX IF NOT EXISTS idx_fps_company_date ON %SCHEMA%.fuel_po_slips (company_id, issue_date DESC)`],
  ['idx_fps_employee',      `CREATE INDEX IF NOT EXISTS idx_fps_employee     ON %SCHEMA%.fuel_po_slips (employee_id)`],
  ['idx_fps_vehicle_odo',   `CREATE INDEX IF NOT EXISTS idx_fps_vehicle_odo  ON %SCHEMA%.fuel_po_slips (vehicle_id, odometer_km DESC)`],
  ['idx_fps_status',        `CREATE INDEX IF NOT EXISTS idx_fps_status       ON %SCHEMA%.fuel_po_slips (status)`],
  ['triggers', `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='vehicles_updated_%SUFFIX%') THEN
        CREATE TRIGGER vehicles_updated_%SUFFIX% BEFORE UPDATE ON %SCHEMA%.vehicles
          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='fuel_po_slips_updated_%SUFFIX%') THEN
        CREATE TRIGGER fuel_po_slips_updated_%SUFFIX% BEFORE UPDATE ON %SCHEMA%.fuel_po_slips
          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
    END $$`],
  ['document_series', `
    INSERT INTO %SCHEMA%.document_series (company_id, doc_type, prefix, start_number, current_number)
    SELECT id, 'fuel_po_slip', 'PO-', 1, 0
    FROM %SCHEMA%.companies
    WHERE NOT EXISTS (
      SELECT 1 FROM %SCHEMA%.document_series ds
       WHERE ds.company_id = companies.id AND ds.doc_type = 'fuel_po_slip'
    )`],
];

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];
  for (const schema of ['public', 'sandbox'] as const) {
    const pool = getPool(schema === 'sandbox');
    for (const [label, sql] of STATEMENTS) {
      try {
        await pool.query(sql.replace(/%SCHEMA%/g, schema).replace(/%SUFFIX%/g, schema));
        results.push(`${schema}.${label}: ok`);
      } catch (e) {
        results.push(`${schema}.${label}: ${(e as Error).message}`);
      }
    }
  }

  return ok({ results });
}
