/*
 * Dressing Plant — end-to-end demo seed.
 *
 * Creates one full tolling flow so the module can be clicked through live:
 *   Booking (job order) → Receiving & weighing → Yield → Cold-chain box
 *   → Tolling invoice (posts Dr 1130 AR / Cr 4100 to the GL) → Delivery order
 *   → Gate pass (released).
 *
 * Idempotent: it keys the demo batch by a fixed batch_no (DEMO-DP-0001) and
 * skips everything if that batch already exists. Safe to re-run.
 *
 * Usage:
 *   POSTGRES_URL="postgresql://…:6543/postgres" node db/seeds/dressing_plant_demo.cjs
 *   (falls back to DATABASE_URL). Use the :6543 transaction pooler.
 */

const pg = require('pg');

const COMPANY_NAME = process.env.DP_DEMO_COMPANY || 'ART FRESH CHICKEN CORP.';
const CUSTOMER_HINT = process.env.DP_DEMO_CUSTOMER || 'Jollibee';
const BATCH_NO = 'DEMO-DP-0001';

async function main() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Set POSTGRES_URL (or DATABASE_URL) to the :6543 transaction pooler.');
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    // --- Anchors ------------------------------------------------------------
    const co = (await c.query(`SELECT id FROM companies WHERE name = $1 LIMIT 1`, [COMPANY_NAME])).rows[0]
            || (await c.query(`SELECT id FROM companies ORDER BY created_at LIMIT 1`)).rows[0];
    if (!co) throw new Error('No company found.');
    const companyId = co.id;

    const branch = (await c.query(`SELECT id FROM branches WHERE company_id = $1 ORDER BY name LIMIT 1`, [companyId])).rows[0];
    const branchId = branch ? branch.id : null;

    const user = (await c.query(
      `SELECT ur.user_id FROM user_roles ur WHERE ur.company_id = $1 OR ur.company_id IS NULL LIMIT 1`, [companyId],
    )).rows[0];
    const userId = user ? user.user_id : null;

    const cust = (await c.query(
      `SELECT id, code, name FROM customers WHERE company_id = $1 AND name ILIKE $2 LIMIT 1`,
      [companyId, `%${CUSTOMER_HINT}%`],
    )).rows[0] || (await c.query(`SELECT id, code, name FROM customers WHERE company_id = $1 ORDER BY name LIMIT 1`, [companyId])).rows[0];
    if (!cust) throw new Error('No customer found — add one under Receivables → Customers.');

    // Idempotency: bail if the demo batch already exists.
    const existing = (await c.query(`SELECT id FROM dp_job_orders WHERE company_id = $1 AND batch_no = $2`, [companyId, BATCH_NO])).rows[0];
    if (existing) {
      console.log(`Demo batch ${BATCH_NO} already exists (${existing.id}). Nothing to do.`);
      return;
    }

    console.log(`Seeding demo flow for ${COMPANY_NAME} / client ${cust.name}…`);

    // --- 1. Tolling client (find-or-create, linked to the customer) ---------
    let client = (await c.query(`SELECT id FROM dp_clients WHERE company_id = $1 AND customer_id = $2 LIMIT 1`, [companyId, cust.id])).rows[0];
    if (!client) {
      client = (await c.query(
        `INSERT INTO dp_clients (company_id, code, name, customer_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (company_id, code) DO UPDATE SET customer_id = EXCLUDED.customer_id RETURNING id`,
        [companyId, cust.code, cust.name, cust.id],
      )).rows[0];
    }
    const clientId = client.id;

    // --- 2. Booking / job order ---------------------------------------------
    const jo = (await c.query(
      `INSERT INTO dp_job_orders
         (company_id, branch_id, batch_no, client_id, notes,
          farm_location, expected_arrival, expected_truck_plate, expected_heads, created_by)
       VALUES ($1,$2,$3,$4,$5,$6, now() + interval '2 hours', $7,$8,$9)
       RETURNING id`,
      [companyId, branchId, BATCH_NO, clientId, 'Demo booking — end-to-end sample flow',
       'Majayjay, Laguna', 'ABC-1234', 2000, userId],
    )).rows[0];
    const jobId = jo.id;
    console.log('  ✓ booking', BATCH_NO);

    // --- 3. Receiving & weighing (fires the batch-lock trigger) -------------
    await c.query(
      `INSERT INTO dp_receiving_weights
         (job_order_id, gross_weight_kg, tare_weight_kg, coop_count, head_count, doa_count, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [jobId, 3600.00, 100.00, 200, 2000, 15, userId],
    );
    console.log('  ✓ receiving (2000 heads, 15 DOA, net live 3500 kg)');

    // --- 4. Yield -----------------------------------------------------------
    await c.query(
      `INSERT INTO dp_yield_records
         (job_order_id, net_live_weight_kg, dressed_recovery_weight_kg, offal_weight_kg, reject_condemned_weight_kg, cutup_config, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [jobId, 3500.00, 2730.00, 560.00, 175.00, 'whole', userId],
    );
    console.log('  ✓ yield (dressed 2730 kg → ~78% recovery)');

    // --- 5. Cold-chain box ---------------------------------------------------
    const box = (await c.query(
      `INSERT INTO dp_storage_boxes (company_id, job_order_id, product, net_weight_kg, pallet, room)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, box_uuid`,
      [companyId, jobId, 'Whole dressed chicken', 2730.00, 'PLT-01', 'Blast-01'],
    )).rows[0];
    console.log('  ✓ cold-chain box', box.box_uuid.slice(0, 8) + '…');

    // --- 6. Tolling invoice (posts to GL via the posting engine) ------------
    const inv = (await c.query(`SELECT dp_generate_tolling_invoice($1, $2) AS id`, [jobId, userId])).rows[0];
    const invRow = (await c.query(
      `SELECT i.amount, i.quantity, i.rate, je.entry_no
         FROM dp_invoices i LEFT JOIN journal_entries je ON je.id = i.journal_entry_id
        WHERE i.id = $1`, [inv.id],
    )).rows[0];
    console.log(`  ✓ tolling invoice: ${invRow.quantity} billable heads × ₱${invRow.rate} = ₱${invRow.amount} (GL ${invRow.entry_no})`);

    // --- 7. Delivery order + gate pass (released) ---------------------------
    const doRow = (await c.query(
      `INSERT INTO dp_delivery_orders (company_id, do_no, job_order_id, client_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, do_no`,
      [companyId, 'DEMO-DO-0001', jobId, clientId, userId],
    )).rows[0];
    await c.query(`INSERT INTO dp_do_lines (do_id, line_no, box_id) VALUES ($1,1,$2)`, [doRow.id, box.id]);

    // Mark the invoice cleared so the gate-pass clearance check passes.
    await c.query(`UPDATE dp_invoices SET status = 'cleared' WHERE job_order_id = $1`, [jobId]);
    await c.query(`UPDATE dp_storage_boxes SET status = 'dispatched', time_out = now() WHERE id = $1`, [box.id]);
    await c.query(
      `INSERT INTO dp_gate_passes (company_id, gate_pass_no, do_id, accounting_status, boxes_expected, boxes_scanned, issued_by)
       VALUES ($1,'DEMO-GP-0001',$2,'cleared',1,1,$3)`,
      [companyId, doRow.id, userId],
    );
    await c.query(`UPDATE dp_delivery_orders SET status = 'released', released_at = now() WHERE id = $1`, [doRow.id]);
    console.log('  ✓ delivery order DEMO-DO-0001 + gate pass DEMO-GP-0001 (released)');

    console.log(`\nDone. Open Dashboard → Dressing Plant → Job Orders to see batch ${BATCH_NO}.`);
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
