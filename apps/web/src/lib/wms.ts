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
