export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const adjRows = await query(
    `SELECT * FROM stock_adjustments WHERE id = $1 LIMIT 1`, [params.id],
  );
  if (!adjRows[0]) return err('Adjustment not found', 404);
  const adj = adjRows[0] as Record<string, unknown>;
  if (adj.status !== 'draft') return err(`Cannot post a ${adj.status} adjustment`, 400);

  const companyRows = await query<{ allow_negative_inventory: boolean }>(
    `SELECT allow_negative_inventory FROM companies WHERE id = $1`, [adj.company_id],
  );
  const allowNegative = companyRows[0]?.allow_negative_inventory ?? false;

  const lines = await query(
    `SELECT sal.*, sb.qty_on_hand, sb.avg_cost
       FROM stock_adjustment_lines sal
       LEFT JOIN stock_balances sb ON sb.item_id = sal.item_id AND sb.warehouse_id = $2
      WHERE sal.adj_id = $1 ORDER BY sal.line_no`,
    [params.id, adj.warehouse_id],
  );
  if (!lines.length) return err('No lines to post', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const l of lines) {
      const qtyChange = Number(l.qty_change);
      const unitCost = Number(l.unit_cost);
      const currentQty = Number(l.qty_on_hand ?? 0);
      const newQty = currentQty + qtyChange;
      if (!allowNegative && newQty < -0.0001) {
        await client.query('ROLLBACK');
        return err(`Item ${l.item_id}: stock would go negative (current: ${currentQty}, change: ${qtyChange}). Enable "Allow Negative Inventory" in Administration to permit this.`, 400);
      }

      // Upsert stock_balances
      const currentAvg = Number(l.avg_cost ?? unitCost);
      const newAvgCost = newQty > 0
        ? (currentQty * currentAvg + qtyChange * unitCost) / newQty
        : currentAvg;

      await client.query(
        `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (item_id, warehouse_id) DO UPDATE
           SET qty_on_hand = $3, avg_cost = $4, last_movement_at = now()`,
        [l.item_id, adj.warehouse_id, newQty, newAvgCost],
      );

      // Append stock movement
      await client.query(
        `INSERT INTO stock_movements
           (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_no, notes, created_by)
         VALUES ($1,$2,$3,'adjustment',$4,$5,$6,'stock_adjustment',$7,$8,$9,$10)`,
        [
          adj.company_id, l.item_id, adj.warehouse_id,
          qtyChange, unitCost, Math.abs(qtyChange) * unitCost,
          params.id, adj.adj_no,
          `${adj.reason_code}: ${adj.notes ?? ''}`.trim(),
          auth.userId,
        ],
      );
    }

    await client.query(
      `UPDATE stock_adjustments SET status='posted', posted_by=$1, posted_at=now(), updated_at=now() WHERE id=$2`,
      [auth.userId, params.id],
    );

    await client.query('COMMIT');

    const updated = await query(`SELECT * FROM stock_adjustments WHERE id = $1 LIMIT 1`, [params.id]);
    return ok(updated[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
