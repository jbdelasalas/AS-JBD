export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// 043 — Warehouse Management System (WMS).
//
// Extends the existing inventory tables rather than replacing them:
//   • bins are a sub-dimension under each warehouse
//   • warehouse-level `stock_balances` is LEFT UNTOUCHED — it stays the single
//     source of truth for stock-on-hand and the GL side. Bin-level quantities
//     live in a new `bin_stock_balances` sub-ledger that rolls up to it.
//   • `stock_movements` gains nullable bin_id/lot_id (additive, safe) so the
//     unified accounting ledger can record which bin a goods-out came from.
//   • lot/batch & serial tracking (items.tracking_mode drives it)
//   • inbound put-away (goods receipt → bin)
//   • outbound pick / pack / ship (sales order → shipment)
//
// All steps are idempotent. Each phase runs in its own transaction so a failure
// in one phase doesn't roll back the others.
export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];

  // ── Phase 1: bins + bin/lot dimension on balances & movements ──────────────
  const c1 = await getPool().connect();
  try {
    await c1.query('BEGIN');

    await c1.query(`
      CREATE TABLE IF NOT EXISTS bins (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        warehouse_id  uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        code          varchar(30) NOT NULL,
        zone          varchar(30),
        bin_type      varchar(20) NOT NULL DEFAULT 'storage'
                        CHECK (bin_type IN ('receiving','storage','picking','staging','shipping')),
        is_active     boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (warehouse_id, code)
      )
    `);
    await c1.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='bins_updated') THEN CREATE TRIGGER bins_updated BEFORE UPDATE ON bins FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);
    await c1.query(`CREATE INDEX IF NOT EXISTS idx_bins_warehouse ON bins (warehouse_id, is_active)`);

    // Tracking mode lives on the item: none | lot | serial
    await c1.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS tracking_mode varchar(10) NOT NULL DEFAULT 'none'`);
    await c1.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE constraint_name='items_tracking_mode_chk') THEN
        ALTER TABLE items ADD CONSTRAINT items_tracking_mode_chk CHECK (tracking_mode IN ('none','lot','serial'));
      END IF;
    END $$`);

    // Lots / batches
    await c1.query(`
      CREATE TABLE IF NOT EXISTS item_lots (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        item_id      uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        lot_no       varchar(60) NOT NULL,
        expiry_date  date,
        received_at  timestamptz NOT NULL DEFAULT now(),
        notes        text,
        UNIQUE (item_id, lot_no)
      )
    `);
    await c1.query(`CREATE INDEX IF NOT EXISTS idx_item_lots_item ON item_lots (item_id)`);
    await c1.query(`CREATE INDEX IF NOT EXISTS idx_item_lots_expiry ON item_lots (expiry_date) WHERE expiry_date IS NOT NULL`);

    // Serial units — each row is one physical unit and its current location/status
    await c1.query(`
      CREATE TABLE IF NOT EXISTS item_serials (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        item_id       uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        serial_no     varchar(80) NOT NULL,
        lot_id        uuid REFERENCES item_lots(id),
        warehouse_id  uuid REFERENCES warehouses(id),
        bin_id        uuid REFERENCES bins(id),
        status        varchar(20) NOT NULL DEFAULT 'in_stock'
                        CHECK (status IN ('in_stock','reserved','shipped','consumed')),
        received_at   timestamptz NOT NULL DEFAULT now(),
        shipped_at    timestamptz,
        UNIQUE (item_id, serial_no)
      )
    `);
    await c1.query(`CREATE INDEX IF NOT EXISTS idx_item_serials_loc ON item_serials (warehouse_id, bin_id, status)`);

    // Bin-level sub-ledger. Rolls up to the warehouse-level stock_balances total;
    // a UNIQUE over COALESCE'd lot keeps one row per (item, bin) when lot is null
    // while allowing per-lot rows. stock_balances itself is deliberately untouched.
    await c1.query(`
      CREATE TABLE IF NOT EXISTS bin_stock_balances (
        id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        item_id          uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        warehouse_id     uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        bin_id           uuid NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
        lot_id           uuid REFERENCES item_lots(id),
        qty_on_hand      numeric(18,4) NOT NULL DEFAULT 0,
        avg_cost         numeric(18,4) NOT NULL DEFAULT 0,
        last_movement_at timestamptz
      )
    `);
    await c1.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bin_stock_item_bin_lot
        ON bin_stock_balances (item_id, bin_id,
          COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
    `);
    await c1.query(`CREATE INDEX IF NOT EXISTS idx_bin_stock_wh ON bin_stock_balances (warehouse_id)`);
    await c1.query(`CREATE INDEX IF NOT EXISTS idx_bin_stock_item ON bin_stock_balances (item_id)`);

    // Additive, nullable dimension on the unified ledger (safe — no constraint change)
    await c1.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS bin_id uuid REFERENCES bins(id)`);
    await c1.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES item_lots(id)`);
    await c1.query(`CREATE INDEX IF NOT EXISTS idx_sm_bin ON stock_movements (bin_id) WHERE bin_id IS NOT NULL`);

    await c1.query('COMMIT');
    results.push('043.1 bins/lots/serials + bin sub-ledger: ok');
  } catch (e) {
    await c1.query('ROLLBACK');
    results.push(`043.1 FAILED: ${(e as Error).message}`);
  } finally { c1.release(); }

  // ── Phase 2: inbound put-away (goods receipt → bin) ────────────────────────
  const c2 = await getPool().connect();
  try {
    await c2.query('BEGIN');

    await c2.query(`
      CREATE TABLE IF NOT EXISTS putaways (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        putaway_no    varchar(30) NOT NULL,
        grn_id        uuid REFERENCES goods_receipts(id),
        warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
        status        varchar(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','posted','cancelled')),
        notes         text,
        posted_at     timestamptz,
        posted_by     uuid REFERENCES users(id),
        created_by    uuid NOT NULL REFERENCES users(id),
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, putaway_no)
      )
    `);
    await c2.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='putaways_updated') THEN CREATE TRIGGER putaways_updated BEFORE UPDATE ON putaways FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);
    await c2.query(`
      CREATE TABLE IF NOT EXISTS putaway_lines (
        id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        putaway_id  uuid NOT NULL REFERENCES putaways(id) ON DELETE CASCADE,
        line_no     int NOT NULL,
        item_id     uuid NOT NULL REFERENCES items(id),
        bin_id      uuid NOT NULL REFERENCES bins(id),
        lot_id      uuid REFERENCES item_lots(id),
        qty         numeric(18,4) NOT NULL,
        unit_cost   numeric(18,4) NOT NULL DEFAULT 0,
        UNIQUE (putaway_id, line_no)
      )
    `);
    await c2.query(`CREATE INDEX IF NOT EXISTS idx_putaways_company_status ON putaways (company_id, status)`);
    await c2.query(`CREATE INDEX IF NOT EXISTS idx_putaways_grn ON putaways (grn_id)`);

    await c2.query('COMMIT');
    results.push('043.2 putaways: ok');
  } catch (e) {
    await c2.query('ROLLBACK');
    results.push(`043.2 FAILED: ${(e as Error).message}`);
  } finally { c2.release(); }

  // ── Phase 3: outbound pick / pack / ship (sales order → shipment) ──────────
  const c3 = await getPool().connect();
  try {
    await c3.query('BEGIN');

    await c3.query(`
      CREATE TABLE IF NOT EXISTS pick_lists (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        pick_no       varchar(30) NOT NULL,
        so_id         uuid REFERENCES sales_orders(id),
        warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
        status        varchar(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','picking','picked','packed','cancelled')),
        notes         text,
        picked_at     timestamptz,
        packed_at     timestamptz,
        picked_by     uuid REFERENCES users(id),
        packed_by     uuid REFERENCES users(id),
        created_by    uuid NOT NULL REFERENCES users(id),
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, pick_no)
      )
    `);
    await c3.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='pick_lists_updated') THEN CREATE TRIGGER pick_lists_updated BEFORE UPDATE ON pick_lists FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);
    await c3.query(`
      CREATE TABLE IF NOT EXISTS pick_list_lines (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        pick_id       uuid NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
        line_no       int NOT NULL,
        item_id       uuid NOT NULL REFERENCES items(id),
        bin_id        uuid NOT NULL REFERENCES bins(id),
        lot_id        uuid REFERENCES item_lots(id),
        qty_to_pick   numeric(18,4) NOT NULL,
        qty_picked    numeric(18,4) NOT NULL DEFAULT 0,
        UNIQUE (pick_id, line_no)
      )
    `);
    await c3.query(`CREATE INDEX IF NOT EXISTS idx_pick_lists_company_status ON pick_lists (company_id, status)`);
    await c3.query(`CREATE INDEX IF NOT EXISTS idx_pick_lists_so ON pick_lists (so_id)`);

    await c3.query(`
      CREATE TABLE IF NOT EXISTS shipments (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        shipment_no   varchar(30) NOT NULL,
        pick_id       uuid REFERENCES pick_lists(id),
        so_id         uuid REFERENCES sales_orders(id),
        warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
        carrier       varchar(100),
        tracking_no   varchar(100),
        status        varchar(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','shipped','cancelled')),
        notes         text,
        shipped_at    timestamptz,
        shipped_by    uuid REFERENCES users(id),
        created_by    uuid NOT NULL REFERENCES users(id),
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, shipment_no)
      )
    `);
    await c3.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='shipments_updated') THEN CREATE TRIGGER shipments_updated BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);
    await c3.query(`
      CREATE TABLE IF NOT EXISTS shipment_lines (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        shipment_id   uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
        line_no       int NOT NULL,
        item_id       uuid NOT NULL REFERENCES items(id),
        bin_id        uuid NOT NULL REFERENCES bins(id),
        lot_id        uuid REFERENCES item_lots(id),
        qty           numeric(18,4) NOT NULL,
        unit_cost     numeric(18,4) NOT NULL DEFAULT 0,
        UNIQUE (shipment_id, line_no)
      )
    `);
    await c3.query(`CREATE INDEX IF NOT EXISTS idx_shipments_company_status ON shipments (company_id, status)`);
    await c3.query(`CREATE INDEX IF NOT EXISTS idx_shipments_so ON shipments (so_id)`);

    await c3.query('COMMIT');
    results.push('043.3 pick_lists/shipments: ok');
  } catch (e) {
    await c3.query('ROLLBACK');
    results.push(`043.3 FAILED: ${(e as Error).message}`);
  } finally { c3.release(); }

  // ── Phase 4: register the wms feature flag (OFF by default) ────────────────
  try {
    await query(
      `INSERT INTO feature_flags (name, enabled, description)
       VALUES ('wms', false, 'Warehouse Management System — bins, put-away, picking, shipping, lot/serial tracking')
       ON CONFLICT (name) DO NOTHING`,
    );
    results.push('043.4 wms feature flag: ok');
  } catch (e) { results.push(`043.4 wms feature flag FAILED: ${(e as Error).message}`); }

  return ok({ results });
}
