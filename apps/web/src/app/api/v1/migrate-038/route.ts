export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// Backfill stock_balances + stock_movements for posted GRs that have no
// stock_movements entry. Two passes:
//   Pass 1 — GRs that already have a warehouse_id (just missing stock_movements).
//   Pass 2 — GRs with null warehouse_id (assigned company's first warehouse).

export async function POST(request: NextRequest) {
  const { secret, warehouse_id: forceWarehouseId } = await request.json().catch(() => ({ secret: '', warehouse_id: undefined }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const client = await getPool().connect();
  const results: string[] = [];

  try {
    await client.query('BEGIN');

    // Pass 1: GRs WITH warehouse_id, missing stock_movements
    const pass1 = await client.query(
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

    // Pass 2: GRs with NULL warehouse_id
    const pass2 = await client.query(
      `SELECT
          gr.id            AS gr_id,
          gr.grn_no,
          gr.company_id,
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
         AND gr.warehouse_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM stock_movements sm
            WHERE sm.reference_type = 'goods_receipt'
              AND sm.reference_id   = gr.id
              AND sm.item_id        = pol.item_id
         )
       ORDER BY gr.receipt_date, gr.grn_no`,
    );

    if (pass1.rows.length === 0 && pass2.rows.length === 0) {
      await client.query('ROLLBACK');
      results.push('ok: no unsynced GR lines found — stock_balances is already up to date');
      return ok({ results });
    }

    // Helper: upsert stock + movement
    async function syncLine(
      compId: string, itemId: string, whId: string, grId: string, grnNo: string,
      qty: number, cost: number, recDate: string,
    ) {
      await client.query(
        `INSERT INTO stock_movements
           (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_no, created_by)
         VALUES ($1,$2,$3,'receipt',$4,$5,$6,'goods_receipt',$7,$8,'system-backfill')
         ON CONFLICT DO NOTHING`,
        [compId, itemId, whId, qty, cost, qty * cost, grId, grnNo],
      );
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
    }

    // Process pass 1
    let count1 = 0;
    for (const row of pass1.rows as Array<Record<string, unknown>>) {
      const qty = Number(row.qty_received);
      if (qty <= 0) continue;
      await syncLine(
        row.company_id as string, row.item_id as string, row.warehouse_id as string,
        row.gr_id as string, row.grn_no as string,
        qty, Number(row.unit_cost ?? 0), row.receipt_date as string,
      );
      count1++;
      results.push(`ok: synced ${row.grn_no} — ${row.item_name} × ${qty}`);
    }

    // Process pass 2 (null warehouse — use provided or company default)
    let count2 = 0;
    const companyWarehouseCache = new Map<string, string | null>();

    for (const row of pass2.rows as Array<Record<string, unknown>>) {
      const qty = Number(row.qty_received);
      if (qty <= 0) continue;
      const compId = row.company_id as string;

      let whId = forceWarehouseId as string | undefined ?? null;
      if (!whId) {
        if (!companyWarehouseCache.has(compId)) {
          const whRows = await client.query(
            `SELECT id FROM warehouses WHERE company_id = $1 AND is_active = true ORDER BY name LIMIT 1`,
            [compId],
          );
          companyWarehouseCache.set(compId, whRows.rows[0]?.id ?? null);
        }
        whId = companyWarehouseCache.get(compId) ?? null;
      }

      if (!whId) {
        results.push(`skip: ${row.grn_no} — no warehouse found for company ${compId}`);
        continue;
      }

      // Update the GR header to record the warehouse so future queries work
      await client.query(
        `UPDATE goods_receipts SET warehouse_id = $2 WHERE id = $1 AND warehouse_id IS NULL`,
        [row.gr_id, whId],
      );

      await syncLine(
        compId, row.item_id as string, whId,
        row.gr_id as string, row.grn_no as string,
        qty, Number(row.unit_cost ?? 0), row.receipt_date as string,
      );
      count2++;
      results.push(`ok: synced (null-wh) ${row.grn_no} — ${row.item_name} × ${qty} → warehouse ${whId}`);
    }

    await client.query('COMMIT');
    results.push(`done: ${count1} with-warehouse + ${count2} null-warehouse GR line(s) backfilled`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Unknown error', 500);
  } finally {
    client.release();
  }

  return ok({ results });
}
