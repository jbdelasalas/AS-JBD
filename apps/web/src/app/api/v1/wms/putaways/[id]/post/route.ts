export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import type { PoolClient } from 'pg';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { adjustBinBalance, putawaySourceRemaining } from '@/lib/wms';

// Posting a put-away places the received quantity into its target bins.
// From a goods receipt or transfer it updates ONLY the bin-level sub-ledger —
// the warehouse total was already incremented when the source posted, so we
// must not touch stock_balances / stock_movements again or the qty would double.
//
// From a dressing-plant batch the put-away IS the move from DP into the
// warehouse, so it also adds to the warehouse total, writes the stock movement,
// creates cold-storage boxes (billing starts) and locks the production lines.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const [pa] = await query(`SELECT * FROM putaways WHERE id = $1 LIMIT 1`, [params.id]);
  if (!pa) return err('Put-away not found', 404);
  if (pa.status !== 'draft') return err('Only draft put-aways can be posted', 400);

  const lines = await query(`SELECT * FROM putaway_lines WHERE putaway_id = $1`, [params.id]);
  if (!lines.length) return err('Put-away has no lines', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (pa.job_order_id) {
      const fail = async (msg: string) => { await client.query('ROLLBACK'); return err(msg, 400); };
      const jo = (await client.query(`SELECT batch_no FROM dp_job_orders WHERE id = $1 FOR UPDATE`, [pa.job_order_id])).rows[0];
      if (!jo) return fail('Production batch not found');
      // Production lines can be edited after the draft was made; never post more than was produced.
      const remaining = await putawaySourceRemaining(client, { jobOrderId: String(pa.job_order_id) });
      for (const l of lines) {
        if ((remaining.get(String(l.item_id))?.qty ?? -1) < -1e-9) return fail('Production output changed — this put-away is more than the batch has left. Cancel it and create a new one.');
      }
      await postFromProduction(client, pa, lines, String(jo.batch_no), auth.userId);
    }
    // One bin update per item + bin + lot (a production batch is hundreds of
    // packs); same result as line by line, cost weighted across the merged lines.
    for (const g of groupBy(lines, (l) => `${l.item_id}|${l.bin_id}|${l.lot_id ?? ''}`)) {
      const qty = g.reduce((a, l) => a + Number(l.qty), 0);
      const cost = qty > 0 ? g.reduce((a, l) => a + Number(l.qty) * Number(l.unit_cost), 0) / qty : 0;
      await adjustBinBalance(
        client, String(pa.company_id), String(g[0].item_id), String(pa.warehouse_id),
        String(g[0].bin_id), g[0].lot_id ? String(g[0].lot_id) : null, qty, cost,
      );
    }
    await client.query(
      `UPDATE putaways SET status='posted', posted_at=now(), posted_by=$1, updated_at=now() WHERE id=$2`,
      [auth.userId, params.id],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to post put-away', 500);
  } finally { client.release(); }

  const [updated] = await query(`SELECT * FROM putaways WHERE id = $1 LIMIT 1`, [params.id]);
  return ok(updated);
}

type Row = Record<string, unknown>;

function groupBy(rows: Row[], key: (r: Row) => string): Row[][] {
  const m = new Map<string, Row[]>();
  for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return [...m.values()];
}

async function postFromProduction(client: PoolClient, pa: Row, lines: Row[], batchNo: string, userId: string) {
  // Warehouse total per item. Output carries no cost yet, so it comes in at 0.
  for (const g of groupBy(lines, (l) => String(l.item_id))) {
    const qty = g.reduce((a, l) => a + Number(l.qty), 0);
    await client.query(
      `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
       VALUES ($1, $2, $3, 0, now())
       ON CONFLICT (item_id, warehouse_id) DO UPDATE
         SET qty_on_hand = stock_balances.qty_on_hand + $3,
             avg_cost = CASE WHEN stock_balances.qty_on_hand + $3 > 0
               THEN (stock_balances.qty_on_hand * stock_balances.avg_cost) / (stock_balances.qty_on_hand + $3)
               ELSE 0 END,
             last_movement_at = now()`,
      [g[0].item_id, pa.warehouse_id, qty],
    );
  }

  // Stock movement per item + bin + lot.
  for (const g of groupBy(lines, (l) => `${l.item_id}|${l.bin_id}|${l.lot_id ?? ''}`)) {
    const qty = g.reduce((a, l) => a + Number(l.qty), 0);
    await client.query(
      `INSERT INTO stock_movements
         (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
          reference_type, reference_id, reference_no, bin_id, lot_id, created_by)
       VALUES ($1,$2,$3,'receipt',$4,0,0,'putaway',$5,$6,$7,$8,$9)`,
      [pa.company_id, g[0].item_id, pa.warehouse_id, qty, pa.id, `${pa.putaway_no} · ${batchNo}`, g[0].bin_id, g[0].lot_id ?? null, userId],
    );
  }

  // Cold-storage box per line (per pack/crate) so the storage clock/billing starts.
  // Each box gets its QR label straight away, so the pack can be stickered and
  // scanned when it is picked.
  const { rows: boxes } = await client.query(
    `INSERT INTO dp_storage_boxes (company_id, job_order_id, product, net_weight_kg, room, warehouse_id, bin_id, item_id, lot_id, dp_output_id)
     SELECT $1, $2, i.name, x.qty, b.code, $3, x.bin_id, x.item_id, x.lot_id, x.dp_output_id
       FROM unnest($4::uuid[], $5::uuid[], $6::uuid[], $7::numeric[], $8::uuid[]) AS x(item_id, bin_id, lot_id, qty, dp_output_id)
       JOIN items i ON i.id = x.item_id
       LEFT JOIN bins b ON b.id = x.bin_id
     RETURNING id`,
    [pa.company_id, pa.job_order_id, pa.warehouse_id,
      lines.map((l) => l.item_id), lines.map((l) => l.bin_id), lines.map((l) => l.lot_id ?? null), lines.map((l) => Number(l.qty)),
      lines.map((l) => l.dp_output_id ?? null)],
  );
  await client.query(
    `INSERT INTO qr_labels (company_id, code, entity_type, entity_id, created_by)
     SELECT $1, 'BOX-' || replace(x.id::text, '-', ''), 'box', x.id, $3 FROM unnest($2::uuid[]) AS x(id)
     ON CONFLICT (code) DO NOTHING`,
    [pa.company_id, boxes.map((b) => b.id), userId],
  );

  // Lock the production lines this put-away covers, so a later save of
  // Production Detail can't rewrite output that is already in a bin.
  const packed = lines.filter((l) => l.dp_output_id);
  if (packed.length) {
    await client.query(
      `UPDATE dp_processed_output po
          SET transferred_kg = COALESCE(po.transferred_kg, 0) + x.qty, transferred_at = now(), transferred_warehouse_id = $1
         FROM unnest($2::uuid[], $3::numeric[]) AS x(id, qty)
        WHERE po.id = x.id`,
      [pa.warehouse_id, packed.map((l) => l.dp_output_id), packed.map((l) => Number(l.qty))],
    );
  }

  // Put-aways made before packs were tracked: spread per item, oldest line first.
  for (const g of groupBy(lines.filter((l) => !l.dp_output_id), (l) => String(l.item_id))) {
    let left = g.reduce((a, l) => a + Number(l.qty), 0);
    const { rows } = await client.query(
      `SELECT id, weight_kg, COALESCE(transferred_kg, 0) AS done FROM dp_processed_output
        WHERE job_order_id = $1 AND item_id = $2 AND weight_kg > COALESCE(transferred_kg, 0)
          AND NOT (COALESCE(transferred_kg, 0) > 0 AND transferred_warehouse_id IS NULL)
        ORDER BY created_at, id FOR UPDATE`,
      [pa.job_order_id, g[0].item_id],
    );
    for (const r of rows) {
      if (left <= 1e-9) break;
      const take = Math.min(left, Number(r.weight_kg) - Number(r.done));
      await client.query(
        `UPDATE dp_processed_output
            SET transferred_kg = COALESCE(transferred_kg, 0) + $2, transferred_at = now(), transferred_warehouse_id = $3
          WHERE id = $1`,
        [r.id, take, pa.warehouse_id],
      );
      left -= take;
    }
  }
}
