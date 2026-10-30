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
    for (const l of lines) {
      await adjustBinBalance(
        client, String(pa.company_id), String(l.item_id), String(pa.warehouse_id),
        String(l.bin_id), l.lot_id ? String(l.lot_id) : null,
        Number(l.qty), Number(l.unit_cost),
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

async function postFromProduction(client: PoolClient, pa: Row, lines: Row[], batchNo: string, userId: string) {
  const qtyByItem = new Map<string, number>();
  for (const l of lines) {
    const itemId = String(l.item_id), qty = Number(l.qty);
    qtyByItem.set(itemId, (qtyByItem.get(itemId) ?? 0) + qty);

    // Warehouse total. Output carries no cost yet, so it comes in at 0.
    await client.query(
      `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
       VALUES ($1, $2, $3, 0, now())
       ON CONFLICT (item_id, warehouse_id) DO UPDATE
         SET qty_on_hand = stock_balances.qty_on_hand + $3,
             avg_cost = CASE WHEN stock_balances.qty_on_hand + $3 > 0
               THEN (stock_balances.qty_on_hand * stock_balances.avg_cost) / (stock_balances.qty_on_hand + $3)
               ELSE 0 END,
             last_movement_at = now()`,
      [itemId, pa.warehouse_id, qty],
    );
    await client.query(
      `INSERT INTO stock_movements
         (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
          reference_type, reference_id, reference_no, bin_id, lot_id, created_by)
       VALUES ($1,$2,$3,'receipt',$4,0,0,'putaway',$5,$6,$7,$8,$9)`,
      [pa.company_id, itemId, pa.warehouse_id, qty, pa.id, `${pa.putaway_no} · ${batchNo}`, l.bin_id, l.lot_id ?? null, userId],
    );

    // Cold-storage box so the storage clock/billing starts.
    await client.query(
      `INSERT INTO dp_storage_boxes (company_id, job_order_id, product, net_weight_kg, room, warehouse_id, bin_id, item_id, lot_id)
       VALUES ($1,$2,(SELECT name FROM items WHERE id = $3),$4,
               (SELECT code FROM bins WHERE id = $5),$6,$5,$3,$7)`,
      [pa.company_id, pa.job_order_id, itemId, qty, l.bin_id, pa.warehouse_id, l.lot_id ?? null],
    );
  }

  // Lock the production lines this put-away covers (oldest first), so a later
  // save of Production Detail can't rewrite output that is already in a bin.
  for (const [itemId, qty] of qtyByItem) {
    let left = qty;
    const { rows } = await client.query(
      `SELECT id, weight_kg, COALESCE(transferred_kg, 0) AS done FROM dp_processed_output
        WHERE job_order_id = $1 AND item_id = $2 AND weight_kg > COALESCE(transferred_kg, 0)
          AND NOT (COALESCE(transferred_kg, 0) > 0 AND transferred_warehouse_id IS NULL)
        ORDER BY created_at, id FOR UPDATE`,
      [pa.job_order_id, itemId],
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
