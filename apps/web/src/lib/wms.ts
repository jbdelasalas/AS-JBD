// Shared helpers for WMS posting routes. Each takes a PoolClient already inside
// a BEGIN/COMMIT so the whole post is atomic.
import type { PoolClient } from 'pg';

/** Next sequential document number, e.g. nextDocNo(c, companyId, 'putaways', 'putaway_no', 'PA'). */
export async function nextDocNo(
  client: PoolClient, companyId: string, table: string, col: string, prefix: string,
): Promise<string> {
  const res = await client.query(`SELECT COUNT(*)::int AS c FROM ${table} WHERE company_id = $1`, [companyId]);
  const n = (res.rows[0].c as number) + 1;
  return `${prefix}-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`;
}

export interface SourceRemaining { qty: number; unitCost: number; }

/** Production output lines (alias po) that go to the warehouse through a put-away. */
export const DP_OUTPUT_PUTAWAY_ELIGIBLE =
  `po.weight_kg > 0 AND NOT (COALESCE(po.transferred_kg, 0) > 0 AND po.transferred_warehouse_id IS NULL)`;

/**
 * What is still left to put away from a goods receipt, a received transfer or a
 * dressing-plant batch's production output, per item: received (or produced)
 * qty minus qty already on draft/posted put-aways from the same source.
 */
export async function putawaySourceRemaining(
  client: Pick<PoolClient, 'query'>,
  src: { grnId?: string | null; transferId?: string | null; jobOrderId?: string | null },
): Promise<Map<string, SourceRemaining>> {
  const { rows } = src.jobOrderId
    ? await client.query(
        // Production output carries no cost yet. DP_OUTPUT_PUTAWAY_ELIGIBLE skips
        // lines binned by the old direct transfer, which never had a put-away.
        `SELECT item_id, SUM(weight_kg) AS qty, 0 AS unit_cost
           FROM dp_processed_output po
          WHERE job_order_id = $1 AND ${DP_OUTPUT_PUTAWAY_ELIGIBLE}
          GROUP BY item_id`, [src.jobOrderId])
    : src.grnId
    ? await client.query(
        `SELECT pol.item_id, SUM(grl.qty_received) AS qty,
                SUM(grl.qty_received * grl.unit_cost) / NULLIF(SUM(grl.qty_received), 0) AS unit_cost
           FROM goods_receipt_lines grl
           JOIN purchase_order_lines pol ON pol.id = grl.po_line_id
          WHERE grl.grn_id = $1
          GROUP BY pol.item_id`, [src.grnId])
    : await client.query(
        `SELECT item_id, SUM(qty) AS qty,
                SUM(qty * COALESCE(unit_cost_at_send, 0)) / NULLIF(SUM(qty), 0) AS unit_cost
           FROM stock_transfer_lines WHERE transfer_id = $1
          GROUP BY item_id`, [src.transferId]);

  const used = await client.query(
    `SELECT pl.item_id, SUM(pl.qty) AS qty
       FROM putaway_lines pl JOIN putaways p ON p.id = pl.putaway_id
      WHERE p.status <> 'cancelled' AND ${src.jobOrderId ? 'p.job_order_id' : src.grnId ? 'p.grn_id' : 'p.transfer_id'} = $1
      GROUP BY pl.item_id`, [src.jobOrderId ?? src.grnId ?? src.transferId]);
  const usedBy = new Map(used.rows.map((r) => [String(r.item_id), Number(r.qty)]));

  return new Map(rows.map((r) => [String(r.item_id), {
    qty: Number(r.qty) - (usedBy.get(String(r.item_id)) ?? 0),
    unitCost: Number(r.unit_cost ?? 0),
  }]));
}

/** Find-or-create an item_lot, returning its id. Returns null when lotNo is blank. */
export async function resolveLot(
  client: PoolClient, companyId: string, itemId: string,
  lotNo: string | null | undefined, expiry?: string | null,
): Promise<string | null> {
  const trimmed = lotNo?.trim();
  if (!trimmed) return null;
  const res = await client.query(
    `INSERT INTO item_lots (company_id, item_id, lot_no, expiry_date)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id, lot_no) DO UPDATE SET expiry_date = COALESCE(EXCLUDED.expiry_date, item_lots.expiry_date)
     RETURNING id`,
    [companyId, itemId, trimmed, expiry ?? null],
  );
  return res.rows[0].id as string;
}

/**
 * Apply a signed quantity to a bin's sub-ledger row with weighted-average cost.
 * Positive qty = into the bin (recosts), negative = out of the bin (cost unchanged).
 */
export async function adjustBinBalance(
  client: PoolClient, companyId: string, itemId: string, warehouseId: string,
  binId: string, lotId: string | null, qty: number, unitCost: number,
): Promise<void> {
  await client.query(
    `INSERT INTO bin_stock_balances (company_id, item_id, warehouse_id, bin_id, lot_id, qty_on_hand, avg_cost, last_movement_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (item_id, bin_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET
       qty_on_hand = bin_stock_balances.qty_on_hand + $6,
       avg_cost = CASE
         WHEN $6 > 0 AND bin_stock_balances.qty_on_hand + $6 > 0
           THEN (bin_stock_balances.qty_on_hand * bin_stock_balances.avg_cost + $6 * $7) / (bin_stock_balances.qty_on_hand + $6)
         ELSE bin_stock_balances.avg_cost END,
       last_movement_at = now()`,
    [companyId, itemId, warehouseId, binId, lotId, qty, unitCost],
  );
}

/** Available qty in a specific bin for an item+lot (lotId null = unlotted row). */
export async function binQtyOnHand(
  client: PoolClient, itemId: string, binId: string, lotId: string | null,
): Promise<number> {
  const res = await client.query(
    `SELECT qty_on_hand FROM bin_stock_balances
      WHERE item_id = $1 AND bin_id = $2
        AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      LIMIT 1`,
    [itemId, binId, lotId],
  );
  return res.rows[0] ? Number(res.rows[0].qty_on_hand) : 0;
}
