export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// QR-driven inventory movement for Warehouse (WMS) and the Dressing Plant.
//
// One `qr_labels` table is the single scan registry for every physical thing we
// label — a bin, a cold-storage box, or a pallet. A scan resolves a code to
// (entity_type, entity_id); the mover then decides what that means. Keeping one
// registry means the scanner never has to guess which table a code belongs to,
// and new label kinds only need a new entity_type.
//
// Runs against BOTH the public and sandbox schemas, since the app serves either
// depending on the x-db-mode header. Idempotent.
const STATEMENTS: [string, string][] = [
  // Pallets — group many storage boxes so one scan moves the whole stack.
  ['pallets', `
    CREATE TABLE IF NOT EXISTS %SCHEMA%.pallets (
      id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id    uuid NOT NULL REFERENCES %SCHEMA%.companies(id) ON DELETE CASCADE,
      pallet_no     varchar(40) NOT NULL,
      warehouse_id  uuid REFERENCES %SCHEMA%.warehouses(id) ON DELETE SET NULL,
      bin_id        uuid REFERENCES %SCHEMA%.bins(id) ON DELETE SET NULL,
      status        varchar(20) NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','closed','shipped')),
      notes         text,
      created_by    uuid REFERENCES %SCHEMA%.users(id),
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, pallet_no)
    )`],
  ['idx_pallets_company', `CREATE INDEX IF NOT EXISTS idx_pallets_company ON %SCHEMA%.pallets (company_id, status)`],
  ['idx_pallets_bin',     `CREATE INDEX IF NOT EXISTS idx_pallets_bin     ON %SCHEMA%.pallets (bin_id) WHERE bin_id IS NOT NULL`],

  // Which pallet a cold-storage box currently sits on (nullable = loose box).
  ['dp_storage_boxes.pallet_id', `
    ALTER TABLE %SCHEMA%.dp_storage_boxes
      ADD COLUMN IF NOT EXISTS pallet_id uuid REFERENCES %SCHEMA%.pallets(id) ON DELETE SET NULL`],
  ['idx_dp_boxes_pallet', `
    CREATE INDEX IF NOT EXISTS idx_dp_boxes_pallet
      ON %SCHEMA%.dp_storage_boxes (pallet_id) WHERE pallet_id IS NOT NULL`],

  // Boxes are produced in the plant, then live in a WMS bin once put away.
  // Nullable so existing rows (and boxes not yet in the warehouse) stay valid.
  ['dp_storage_boxes.bin_id', `
    ALTER TABLE %SCHEMA%.dp_storage_boxes
      ADD COLUMN IF NOT EXISTS bin_id uuid REFERENCES %SCHEMA%.bins(id) ON DELETE SET NULL`],
  ['dp_storage_boxes.warehouse_id', `
    ALTER TABLE %SCHEMA%.dp_storage_boxes
      ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES %SCHEMA%.warehouses(id) ON DELETE SET NULL`],
  ['dp_storage_boxes.item_id', `
    ALTER TABLE %SCHEMA%.dp_storage_boxes
      ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES %SCHEMA%.items(id) ON DELETE SET NULL`],
  ['dp_storage_boxes.lot_id', `
    ALTER TABLE %SCHEMA%.dp_storage_boxes
      ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES %SCHEMA%.item_lots(id) ON DELETE SET NULL`],

  // The scan registry. `code` is what the QR actually encodes and is globally
  // unique, so a scan needs no company context to resolve.
  ['qr_labels', `
    CREATE TABLE IF NOT EXISTS %SCHEMA%.qr_labels (
      id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id   uuid NOT NULL REFERENCES %SCHEMA%.companies(id) ON DELETE CASCADE,
      code         varchar(64) NOT NULL,
      entity_type  varchar(20) NOT NULL
                     CHECK (entity_type IN ('bin','box','pallet')),
      entity_id    uuid NOT NULL,
      is_active    boolean NOT NULL DEFAULT true,
      printed_at   timestamptz,
      created_by   uuid REFERENCES %SCHEMA%.users(id),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (code)
    )`],
  ['idx_qr_labels_entity', `
    CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_labels_entity
      ON %SCHEMA%.qr_labels (entity_type, entity_id) WHERE is_active`],
  ['idx_qr_labels_company', `CREATE INDEX IF NOT EXISTS idx_qr_labels_company ON %SCHEMA%.qr_labels (company_id, entity_type)`],

  // Append-only scan/movement journal. Every committed move writes one row per
  // moved thing, so the floor has a traceable history even for zero-qty moves
  // (e.g. relocating an empty pallet).
  ['inventory_scan_events', `
    CREATE TABLE IF NOT EXISTS %SCHEMA%.inventory_scan_events (
      id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id     uuid NOT NULL REFERENCES %SCHEMA%.companies(id) ON DELETE CASCADE,
      move_ref       uuid NOT NULL,
      entity_type    varchar(20) NOT NULL,
      entity_id      uuid NOT NULL,
      code           varchar(64),
      from_bin_id    uuid REFERENCES %SCHEMA%.bins(id) ON DELETE SET NULL,
      to_bin_id      uuid REFERENCES %SCHEMA%.bins(id) ON DELETE SET NULL,
      item_id        uuid REFERENCES %SCHEMA%.items(id) ON DELETE SET NULL,
      lot_id         uuid REFERENCES %SCHEMA%.item_lots(id) ON DELETE SET NULL,
      qty            numeric(18,4) NOT NULL DEFAULT 0,
      scanned_by     uuid REFERENCES %SCHEMA%.users(id),
      scanned_at     timestamptz NOT NULL DEFAULT now(),
      device_label   varchar(60),
      notes          text
    )`],
  ['idx_scan_events_move',   `CREATE INDEX IF NOT EXISTS idx_scan_events_move    ON %SCHEMA%.inventory_scan_events (move_ref)`],
  ['idx_scan_events_recent', `CREATE INDEX IF NOT EXISTS idx_scan_events_recent  ON %SCHEMA%.inventory_scan_events (company_id, scanned_at DESC)`],
  ['idx_scan_events_entity', `CREATE INDEX IF NOT EXISTS idx_scan_events_entity  ON %SCHEMA%.inventory_scan_events (entity_type, entity_id, scanned_at DESC)`],

  ['triggers', `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='pallets_updated_%SUFFIX%') THEN
        CREATE TRIGGER pallets_updated_%SUFFIX% BEFORE UPDATE ON %SCHEMA%.pallets
          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='qr_labels_updated_%SUFFIX%') THEN
        CREATE TRIGGER qr_labels_updated_%SUFFIX% BEFORE UPDATE ON %SCHEMA%.qr_labels
          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
    END $$`],

  // Backfill: every existing bin and in-storage box gets a label so the feature
  // is usable the moment it ships, without a manual labelling pass.
  ['backfill_bin_labels', `
    INSERT INTO %SCHEMA%.qr_labels (company_id, code, entity_type, entity_id)
    SELECT b.company_id, 'BIN-' || replace(b.id::text, '-', ''), 'bin', b.id
      FROM %SCHEMA%.bins b
     WHERE NOT EXISTS (
       SELECT 1 FROM %SCHEMA%.qr_labels q
        WHERE q.entity_type = 'bin' AND q.entity_id = b.id
     )`],
  ['backfill_box_labels', `
    INSERT INTO %SCHEMA%.qr_labels (company_id, code, entity_type, entity_id)
    SELECT x.company_id, 'BOX-' || replace(x.box_uuid::text, '-', ''), 'box', x.id
      FROM %SCHEMA%.dp_storage_boxes x
     WHERE NOT EXISTS (
       SELECT 1 FROM %SCHEMA%.qr_labels q
        WHERE q.entity_type = 'box' AND q.entity_id = x.id
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
