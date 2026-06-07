export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// Backfill stock_balances + stock_movements for posted GRs that have no
// stock_movements entry (i.e. created before the GR route was updated to
// write stock movements).

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const client = await getPool().connect();
  const results: string[] = [];

  try {
    await client.query('BEGIN');

    // Find all posted GR lines that have no stock_movement record yet
    const unsynced = await client.query(
      `SELECT
          gr.id            AS gr_id,
          gr.grn_no,
          gr.company_id,
          gr.warehouse_id,
          gr.receipt_date,
          pol.item_id,
          grl.qty_received,
          grl.unit_cost,
          i.name           AS item_name
       FROM goods_receipts gr
       JOIN goods_receipt_lines grl ON grl.grn_id = gr.id
       JOIN purchase_order_lines pol ON pol.id = grl.po_line_id
       JOIN items i ON i.id = pol.item_id
       WHERE gr.status = 'posted'
         AND pol.item_id IS NOT NULL
         AND gr.warehouse_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM stock_movements sm
            WHERE sm.reference_type = 'goods_receipt'
              AND sm.reference_id   = gr.id
              AND sm.item_id        = pol.item_id
         )
       ORDER BY gr.receipt_date, gr.grn_no`,
    );

    if (unsynced.rows.length === 0) {
      await client.query('ROLLBACK');
      results.push('ok: no unsynced GR lines found — stock_balances is already up to date');
      return ok({ results });
    }

    let synced = 0;
    for (const row of unsynced.rows as Array<Record<string, unknown>>) {
      const qty      = Number(row.qty_received);
      const cost     = Number(row.unit_cost ?? 0);
      const itemId   = row.item_id   as string;
      const whId     = row.warehouse_id as string;
      const compId   = row.company_id  as string;
      const grId     = row.gr_id       as string;
      const grnNo    = row.grn_no      as string;
      const recDate  = row.receipt_date as string;

      if (qty <= 0) continue;

      // Insert stock_movement
      await client.query(
        `INSERT INTO stock_movements
           (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_no, created_by)
         VALUES ($1,$2,$3,'receipt',$4,$5,$6,'goods_receipt',$7,$8,'system-backfill')
         ON CONFLICT DO NOTHING`,
        [compId, itemId, whId, qty, cost, qty * cost, grId, grnNo],
      );

      // Upsert stock_balances with weighted-average cost
      await client.query(
        `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (item_id, warehouse_id) DO UPDATE
           SET avg_cost = CASE
                 WHEN stock_balances.qty_on_hand + $3 > 0
                 THEN (stock_balances.qty_on_hand * stock_balances.avg_cost + $3 * $4)
                        / (stock_balances.qty_on_hand + $3)
                 ELSE $4
               END,
               qty_on_hand = stock_balances.qty_on_hand + $3,
               last_movement_at = GREATEST(stock_balances.last_movement_at, $5)`,
        [itemId, whId, qty, cost, recDate],
      );

      synced++;
      results.push(`ok: synced ${grnNo} — ${row.item_name} × ${qty} @ ${cost}`);
    }

    await client.query('COMMIT');
    results.push(`done: ${synced} GR line(s) backfilled into stock_balances`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Unknown error', 500);
  } finally {
    client.release();
  }

  return ok({ results });
}
