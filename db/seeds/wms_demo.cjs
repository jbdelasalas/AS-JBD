/*
 * WMS — sample data seed.
 *
 * Builds a realistic warehouse scenario in one warehouse so the module can be
 * clicked through live:
 *   Bins (receiving/storage/picking/shipping) → lot-tracked item + lots
 *   → posted Put-away (fills bin_stock_balances) → Pick list → Shipment
 *   (draws bin stock down).
 *
 * Idempotent: keyed by fixed doc numbers (bins WMS-*, PUT-DEMO-0001,
 * PICK-DEMO-0001, SHIP-DEMO-0001). Re-running is a no-op once seeded.
 *
 * Usage:
 *   POSTGRES_URL="postgresql://…:6543/postgres" node db/seeds/wms_demo.cjs
 */

const pg = require('pg');

const COMPANY_NAME = process.env.WMS_DEMO_COMPANY || 'ART FRESH CHICKEN CORP.';
const WAREHOUSE_NAME = process.env.WMS_DEMO_WAREHOUSE || 'Distribution';

async function main() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Set POSTGRES_URL (or DATABASE_URL) to the :6543 transaction pooler.');
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const co = (await c.query(`SELECT id FROM companies WHERE name = $1 LIMIT 1`, [COMPANY_NAME])).rows[0]
            || (await c.query(`SELECT id FROM companies ORDER BY created_at LIMIT 1`)).rows[0];
    const companyId = co.id;

    const wh = (await c.query(`SELECT id FROM warehouses WHERE company_id = $1 AND name = $2 LIMIT 1`, [companyId, WAREHOUSE_NAME])).rows[0]
            || (await c.query(`SELECT id FROM warehouses WHERE company_id = $1 ORDER BY name LIMIT 1`, [companyId])).rows[0];
    if (!wh) throw new Error('No warehouse found.');
    const warehouseId = wh.id;

    const user = (await c.query(
      `SELECT ur.user_id FROM user_roles ur WHERE ur.company_id = $1 OR ur.company_id IS NULL LIMIT 1`, [companyId],
    )).rows[0];
    const userId = user ? user.user_id : null;

    // Two items: one lot-tracked (feed), one plain.
    const feed = (await c.query(`SELECT id, name FROM items WHERE company_id = $1 AND sku = 'FEED-GROWER' LIMIT 1`, [companyId])).rows[0]
              || (await c.query(`SELECT id, name FROM items WHERE company_id = $1 ORDER BY name LIMIT 1`, [companyId])).rows[0];
    const doc = (await c.query(`SELECT id, name FROM items WHERE company_id = $1 AND sku = 'DOC-ROSS308' LIMIT 1`, [companyId])).rows[0]
             || feed;

    if ((await c.query(`SELECT 1 FROM bins WHERE company_id = $1 AND code = 'WMS-STG-01' LIMIT 1`, [companyId])).rows[0]) {
      console.log('WMS demo already seeded (bin WMS-STG-01 exists). Nothing to do.');
      return;
    }

    console.log(`Seeding WMS demo in ${COMPANY_NAME} / ${WAREHOUSE_NAME}…`);

    // --- 1. Bins ------------------------------------------------------------
    const binDefs = [
      ['WMS-RCV-01', 'DOCK', 'receiving'],
      ['WMS-STG-01', 'A1',   'storage'],
      ['WMS-STG-02', 'A2',   'storage'],
      ['WMS-PCK-01', 'P1',   'picking'],
      ['WMS-SHP-01', 'DOCK', 'shipping'],
    ];
    const bin = {};
    for (const [code, zone, type] of binDefs) {
      const r = (await c.query(
        `INSERT INTO bins (company_id, warehouse_id, code, zone, bin_type)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (warehouse_id, code) DO UPDATE SET zone = EXCLUDED.zone
         RETURNING id`,
        [companyId, warehouseId, code, zone, type],
      )).rows[0];
      bin[code] = r.id;
    }
    console.log(`  ✓ ${binDefs.length} bins (receiving / storage / picking / shipping)`);

    // --- 2. Lot-track the feed item + create two lots -----------------------
    await c.query(`UPDATE items SET tracking_mode = 'lot' WHERE id = $1 AND tracking_mode = 'none'`, [feed.id]);
    const lotA = (await c.query(
      `INSERT INTO item_lots (company_id, item_id, lot_no, expiry_date, notes)
       VALUES ($1,$2,'LOT-2026-A', now()::date + 180, 'Demo lot A')
       ON CONFLICT (item_id, lot_no) DO UPDATE SET notes = EXCLUDED.notes RETURNING id`,
      [companyId, feed.id],
    )).rows[0].id;
    const lotB = (await c.query(
      `INSERT INTO item_lots (company_id, item_id, lot_no, expiry_date, notes)
       VALUES ($1,$2,'LOT-2026-B', now()::date + 90, 'Demo lot B (nearer expiry)')
       ON CONFLICT (item_id, lot_no) DO UPDATE SET notes = EXCLUDED.notes RETURNING id`,
      [companyId, feed.id],
    )).rows[0].id;
    console.log(`  ✓ ${feed.name} set to lot-tracked; lots LOT-2026-A / LOT-2026-B`);

    // Helper: upsert bin stock (mirrors the put-away/shipment sub-ledger logic).
    const NIL = '00000000-0000-0000-0000-000000000000';
    async function moveBinStock(itemId, binId, lotId, qty, unitCost) {
      await c.query(
        `INSERT INTO bin_stock_balances (company_id, item_id, warehouse_id, bin_id, lot_id, qty_on_hand, avg_cost, last_movement_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (item_id, bin_id, COALESCE(lot_id, '${NIL}'::uuid)) DO UPDATE SET
           qty_on_hand = bin_stock_balances.qty_on_hand + EXCLUDED.qty_on_hand,
           avg_cost = CASE WHEN bin_stock_balances.qty_on_hand + EXCLUDED.qty_on_hand > 0
                      THEN (bin_stock_balances.qty_on_hand * bin_stock_balances.avg_cost + EXCLUDED.qty_on_hand * EXCLUDED.avg_cost)
                           / (bin_stock_balances.qty_on_hand + EXCLUDED.qty_on_hand)
                      ELSE EXCLUDED.avg_cost END,
           last_movement_at = now()`,
        [companyId, itemId, warehouseId, binId, lotId, qty, unitCost],
      );
    }

    // --- 3. Put-away (posted) — fills storage bins --------------------------
    const grn = (await c.query(`SELECT id FROM goods_receipts WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`, [companyId])).rows[0];
    const put = (await c.query(
      `INSERT INTO putaways (company_id, putaway_no, grn_id, warehouse_id, status, posted_at, posted_by, created_by)
       VALUES ($1,'PUT-DEMO-0001',$2,$3,'posted', now(), $4, $4) RETURNING id`,
      [companyId, grn ? grn.id : null, warehouseId, userId],
    )).rows[0].id;
    const putLines = [
      [feed.id, bin['WMS-STG-01'], lotA, 300, 1250.00],
      [feed.id, bin['WMS-STG-02'], lotB, 150, 1250.00],
      [doc.id,  bin['WMS-STG-01'], null, 5000,   28.00],
    ];
    let ln = 0;
    for (const [itemId, binId, lotId, qty, cost] of putLines) {
      ln += 1;
      await c.query(
        `INSERT INTO putaway_lines (putaway_id, line_no, item_id, bin_id, lot_id, qty, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [put, ln, itemId, binId, lotId, qty, cost],
      );
      await moveBinStock(itemId, binId, lotId, qty, cost);
    }
    console.log('  ✓ put-away PUT-DEMO-0001 posted (feed 300+150 bags across 2 lots, 5000 chicks)');

    // --- 4. Pick list + shipment (draws stock down) -------------------------
    const so = (await c.query(`SELECT id FROM sales_orders WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`, [companyId])).rows[0];
    const pick = (await c.query(
      `INSERT INTO pick_lists (company_id, pick_no, so_id, warehouse_id, status, picked_at, picked_by, created_by)
       VALUES ($1,'PICK-DEMO-0001',$2,$3,'picked', now(), $4, $4) RETURNING id`,
      [companyId, so ? so.id : null, warehouseId, userId],
    )).rows[0].id;
    // Pick 100 bags of feed from lot A (FEFO would prefer B; here we pick A for the demo).
    await c.query(
      `INSERT INTO pick_list_lines (pick_id, line_no, item_id, bin_id, lot_id, qty_to_pick, qty_picked)
       VALUES ($1,1,$2,$3,$4,$5,$5)`,
      [pick, feed.id, bin['WMS-STG-01'], lotA, 100],
    );

    const ship = (await c.query(
      `INSERT INTO shipments (company_id, shipment_no, pick_id, so_id, warehouse_id, carrier, status, shipped_at, shipped_by, created_by)
       VALUES ($1,'SHIP-DEMO-0001',$2,$3,$4,'JRS Express','shipped', now(), $5, $5) RETURNING id`,
      [companyId, pick, so ? so.id : null, warehouseId, userId],
    )).rows[0].id;
    await c.query(
      `INSERT INTO shipment_lines (shipment_id, line_no, item_id, bin_id, lot_id, qty, unit_cost)
       VALUES ($1,1,$2,$3,$4,$5,$6)`,
      [ship, feed.id, bin['WMS-STG-01'], lotA, 100, 1250.00],
    );
    await moveBinStock(feed.id, bin['WMS-STG-01'], lotA, -100, 1250.00); // draw down
    console.log('  ✓ pick PICK-DEMO-0001 + shipment SHIP-DEMO-0001 (100 bags out, lot A)');

    // --- Snapshot -----------------------------------------------------------
    const snap = await c.query(
      `SELECT b.code AS bin, i.name AS item, l.lot_no, bs.qty_on_hand
         FROM bin_stock_balances bs
         JOIN bins b ON b.id = bs.bin_id
         JOIN items i ON i.id = bs.item_id
         LEFT JOIN item_lots l ON l.id = bs.lot_id
        WHERE bs.warehouse_id = $1 AND b.code LIKE 'WMS-%'
        ORDER BY b.code, i.name`, [warehouseId],
    );
    console.log('\n  Bin stock now:');
    snap.rows.forEach((r) => console.log(`    ${r.bin}  ${r.item}${r.lot_no ? ' ['+r.lot_no+']' : ''}: ${Number(r.qty_on_hand)}`));
    console.log(`\nDone. Open Dashboard → Warehouse to see bins, bin stock, put-away, picks and shipments.`);
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
