/*
 * Trip Planning — demo seed for Art Fresh.
 *
 * Gives the planner something to plan without touching the books:
 *   - one depot warehouse (DEMO-DEPOT) with a map pin,
 *   - eight delivery trucks (plates DEMO-101 … DEMO-108), mixed sizes, six
 *     refrigerated, each with a default driver and helper,
 *   - a 45-order SO list written to db/seeds/trip_planning_sample_orders.tsv,
 *     ready to paste into "Paste from Excel",
 *   - map pins for those 45 addresses in geocode_cache, so "Find locations"
 *     places them instantly instead of asking a geocoder about made-up shops.
 *
 * No customers, sales orders or GL entries are created — the orders live only
 * in the paste file. Everything else is keyed by the DEMO prefix.
 *
 * Idempotent; safe to re-run. Remove it all with --remove.
 *
 * Usage:
 *   POSTGRES_URL="postgresql://…" node db/seeds/trip_planning_demo.cjs
 *   POSTGRES_URL="postgresql://…" node db/seeds/trip_planning_demo.cjs --remove
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const COMPANY_NAME = process.env.TP_DEMO_COMPANY || 'ART FRESH CHICKEN CORP.';
const DEPOT = { code: 'DEMO-DEPOT', name: 'Demo Depot (trip planning test)', address: 'Lipa City, Batangas', lat: 13.9411, lng: 121.1631 };
const TSV_PATH = path.join(__dirname, 'trip_planning_sample_orders.tsv');

const TRUCKS = [
  ['DEMO-101', 'Isuzu Elf reefer', 2000, true,  'Mario Santos',    'Jun Reyes'],
  ['DEMO-102', 'Isuzu Elf reefer', 2000, true,  'Ramon Dela Cruz', 'Paolo Garcia'],
  ['DEMO-103', 'Fuso Canter reefer', 3500, true, 'Ernesto Bautista','Mark Villanueva'],
  ['DEMO-104', 'Fuso Canter reefer', 3500, true, 'Danilo Aquino',   'Jomar Castillo'],
  ['DEMO-105', 'Isuzu Forward reefer', 5000, true, 'Rolando Mendoza','Kevin Ramos'],
  ['DEMO-106', 'Isuzu Forward reefer', 5000, true, 'Arnel Navarro',  'Jayson Torres'],
  ['DEMO-107', 'L300 closed van', 1000, false,  'Noel Flores',      'Ariel Cruz'],
  ['DEMO-108', 'Elf dropside', 2500, false,     'Rodel Pascual',    'Benjie Lopez'],
];

// Town centres; each order is jittered a little around its town.
const TOWNS = [
  ['Lipa City, Batangas', 13.9411, 121.1631], ['Tanauan City, Batangas', 14.0863, 121.1497],
  ['Sto. Tomas, Batangas', 14.1079, 121.1414], ['Batangas City, Batangas', 13.7565, 121.0583],
  ['San Jose, Batangas', 13.8777, 121.1050], ['Malvar, Batangas', 14.0446, 121.1586],
  ['Rosario, Batangas', 13.8460, 121.2060], ['Ibaan, Batangas', 13.8176, 121.1330],
  ['Lemery, Batangas', 13.8817, 120.9131], ['Bauan, Batangas', 13.7917, 121.0085],
  ['Padre Garcia, Batangas', 13.8790, 121.2131], ['Calamba City, Laguna', 14.2117, 121.1653],
  ['Los Baños, Laguna', 14.1699, 121.2440], ['San Pablo City, Laguna', 14.0683, 121.3256],
  ['Cabuyao City, Laguna', 14.2722, 121.1251], ['Tiaong, Quezon', 13.9605, 121.3234],
  ['Candelaria, Quezon', 13.9311, 121.4233],
];
const SHOPS = ['Aling Nena Store', 'Kusina ni Juan', 'Mang Tonyo Lechon Manok', 'Palengke Stall', 'Chicken Haus',
  'Lutong Bahay Eatery', 'JM Grocery', 'Golden Grill', 'Tita Baby Carinderia', 'Fresh Mart', 'Sunrise Restaurant',
  'Inasal Corner', 'Bente Uno Mart', 'Masagana Store', 'Kainan sa Kanto'];
const STREETS = ['Rizal St.', 'Mabini St.', 'Burgos St.', 'P. Torres St.', 'Luna St.', 'Bonifacio St.', 'National Hwy', 'Brgy. Poblacion'];
const PRODUCTS = [['Whole Dressed Chicken', 150, 600], ['Breast Fillet', 50, 220], ['Chicken Wings', 40, 160], ['Leg Quarters', 50, 260], ['Liver & Gizzard', 10, 60]];
const REMARKS = ['', '', '', '', 'before 8am lang', 'hapon na i-deliver, sarado umaga', 'small truck lang, makitid ang daan',
  'receive 6-9am only', 'back gate, call Ate Weng pagdating', 'after 10am, closed early morning', 'rush — before 7:30am'];

/** Same normalisation as apps/web/src/lib/routing/geocode.ts addressKey(). */
const addressKey = (a) => a.toLowerCase().replace(/[\s,]+/g, ' ').trim();

function buildOrders() {
  let seed = 20261013;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const orders = [];
  for (let i = 0; i < 45; i++) {
    const [town, lat, lng] = TOWNS[i % TOWNS.length];
    const shop = `${pick(SHOPS)} ${town.split(',')[0].replace(/ City$/, '')}${i >= TOWNS.length ? ` #${Math.floor(i / TOWNS.length) + 1}` : ''}`;
    const address = `${Math.floor(rnd() * 400) + 1} ${pick(STREETS)}, ${town}`;
    const lines = [];
    const n = 1 + Math.floor(rnd() * 3);
    const used = new Set();
    while (lines.length < n) {
      const [p, lo, hi] = pick(PRODUCTS);
      if (used.has(p)) continue;
      used.add(p);
      lines.push([p, Math.round(lo + rnd() * (hi - lo))]);
    }
    orders.push({
      so: `SO-DEMO-${String(1001 + i)}`,
      customer: shop,
      address,
      lat: +(lat + (rnd() - 0.5) * 0.02).toFixed(6),
      lng: +(lng + (rnd() - 0.5) * 0.02).toFixed(6),
      lines,
      remarks: pick(REMARKS),
    });
  }
  return orders;
}

function writeTsv(orders) {
  const rows = [['SO No', 'Customer', 'Address', 'Product', 'Qty', 'UOM', 'Remarks'].join('\t')];
  for (const o of orders) {
    o.lines.forEach(([p, kg], k) => rows.push([o.so, o.customer, o.address, p, kg, 'kg', k === 0 ? o.remarks : ''].join('\t')));
  }
  fs.writeFileSync(TSV_PATH, rows.join('\n') + '\n');
}

async function main() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Set POSTGRES_URL (or DATABASE_URL).');
  const c = new pg.Client({ connectionString: url.replace(/([?&])sslmode=[^&]*/g, '$1'), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const co = (await c.query(`SELECT id, name FROM companies WHERE name = $1 LIMIT 1`, [COMPANY_NAME])).rows[0];
    if (!co) throw new Error(`Company "${COMPANY_NAME}" not found.`);
    const orders = buildOrders();
    await c.query('BEGIN');

    if (process.argv.includes('--remove')) {
      const v = await c.query(`DELETE FROM vehicles WHERE company_id = $1 AND plate_no LIKE 'DEMO-%' AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = vehicles.id)`, [co.id]);
      const g = await c.query(`DELETE FROM geocode_cache WHERE company_id = $1 AND address_key = ANY($2)`, [co.id, orders.map((o) => addressKey(o.address))]);
      const w = await c.query(`DELETE FROM warehouses WHERE company_id = $1 AND code = $2
                                 AND NOT EXISTS (SELECT 1 FROM route_plans p WHERE p.depot_warehouse_id = warehouses.id)`, [co.id, DEPOT.code]);
      await c.query('COMMIT');
      console.log(`Removed ${v.rowCount} trucks, ${g.rowCount} pins, ${w.rowCount} depot. (Trucks/depot used by a confirmed trip are kept — cancel those trips first.)`);
      return;
    }

    const branch = (await c.query(`SELECT id FROM branches WHERE company_id = $1 ORDER BY name LIMIT 1`, [co.id])).rows[0];
    await c.query(
      `INSERT INTO warehouses (company_id, branch_id, code, name, warehouse_type, address, latitude, longitude)
       VALUES ($1,$2,$3,$4,'depot',$5,$6,$7)
       ON CONFLICT (company_id, code) DO UPDATE SET latitude = COALESCE(warehouses.latitude, EXCLUDED.latitude),
                                                    longitude = COALESCE(warehouses.longitude, EXCLUDED.longitude)`,
      [co.id, branch ? branch.id : null, DEPOT.code, DEPOT.name, DEPOT.address, DEPOT.lat, DEPOT.lng],
    );
    for (const [plate, desc, kg, reefer, driver, helper] of TRUCKS) {
      await c.query(
        `INSERT INTO vehicles (company_id, plate_no, description, vehicle_type, capacity_kg, is_refrigerated,
                               default_driver, default_helper, for_delivery, notes)
         VALUES ($1,$2,$3,'truck',$4,$5,$6,$7,true,'Demo truck for trip planning — remove with the seed''s --remove')
         ON CONFLICT (company_id, plate_no) DO NOTHING`,
        [co.id, plate, desc, kg, reefer, driver, helper],
      );
    }
    for (const o of orders) {
      await c.query(
        `INSERT INTO geocode_cache (company_id, address_key, latitude, longitude, formatted, source, precise)
         VALUES ($1,$2,$3,$4,$5,'manual',true)
         ON CONFLICT (company_id, address_key) DO NOTHING`,
        [co.id, addressKey(o.address), o.lat, o.lng, o.address],
      );
    }
    await c.query('COMMIT');
    writeTsv(orders);
    const kg = orders.reduce((a, o) => a + o.lines.reduce((b, l) => b + l[1], 0), 0);
    console.log(`Seeded for ${co.name}: depot ${DEPOT.code}, ${TRUCKS.length} trucks (${TRUCKS.reduce((a, t) => a + t[2], 0)} kg capacity), ${orders.length} order pins.`);
    console.log(`Sample orders (${kg} kg): ${TSV_PATH}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
