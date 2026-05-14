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
  if (adj.status !== 'posted') return err('Only posted adjustments can be voided', 400);

  const lines = await query(
    `SELECT sal.*, sb.qty_on_hand
       FROM stock_adjustment_lines sal
       LEFT JOIN stock_balances sb ON sb.item_id = sal.item_id AND sb.warehouse_id = $2
      WHERE sal.adj_id = $1`,
    [params.id, adj.warehouse_id],
  );

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const l of lines) {
      const reversal = -Number(l.qty_change);
      const currentQty = Number(l.qty_on_hand ?? 0);
      const newQty = currentQty + reversal;
      if (newQty < -0.0001) {
        await client.query('ROLLBACK');
        return err(`Cannot void: item ${l.item_id} stock would go negative`, 400);
      }
      await client.query(
        `UPDATE stock_balances SET qty_on_hand = $1, last_movement_at = now()
          WHERE item_id = $2 AND warehouse_id = $3`,
        [newQty, l.item_id, adj.warehouse_id],
      );
      await client.query(
        `INSERT INTO stock_movements
           (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_no, notes, created_by)
         VALUES ($1,$2,$3,'adjustment',$4,$5,$6,'stock_adjustment',$7,$8,$9,$10)`,
        [
          adj.company_id, l.item_id, adj.warehouse_id,
          reversal, Number(l.unit_cost), Math.abs(reversal) * Number(l.unit_cost),
          params.id, adj.adj_no,
          `VOID of ${adj.adj_no}`,
          auth.userId,
        ],
      );
    }

    await client.query(
      `UPDATE stock_adjustments SET status='voided', updated_at=now() WHERE id=$1`,
      [params.id],
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
