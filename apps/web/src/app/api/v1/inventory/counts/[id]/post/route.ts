export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(`SELECT * FROM stock_counts WHERE id = $1 LIMIT 1`, [params.id]);
  if (!rows[0]) return err('Not found', 404);
  const cnt = rows[0] as Record<string, unknown>;
  if (cnt.status !== 'in_progress') return err('Count must be in_progress to post', 400);

  const lines = await query(
    `SELECT * FROM stock_count_lines WHERE count_id = $1`, [params.id],
  );

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const l of lines) {
      const variance = Number(l.variance);
      if (Math.abs(variance) < 0.0001) continue;

      const unitCost = Number(l.unit_cost);

      // Apply variance to stock_balances
      await client.query(
        `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (item_id, warehouse_id) DO UPDATE
           SET qty_on_hand = stock_balances.qty_on_hand + $5,
               last_movement_at = now()`,
        [l.item_id, cnt.warehouse_id, Math.max(0, Number(l.system_qty) + variance), unitCost, variance],
      );

      // Record stock movement
      await client.query(
        `INSERT INTO stock_movements
           (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_no, notes, created_by)
         VALUES ($1,$2,$3,'adjustment',$4,$5,$6,'stock_count',$7,$8,$9,$10)`,
        [
          cnt.company_id, l.item_id, cnt.warehouse_id,
          variance, unitCost, Math.abs(variance) * unitCost,
          params.id, cnt.count_no, `Count correction: ${cnt.count_no}`, auth.userId,
        ],
      );
    }

    await client.query(
      `UPDATE stock_counts SET status='posted', posted_by=$1, posted_at=now(), updated_at=now() WHERE id=$2`,
      [auth.userId, params.id],
    );

    await client.query('COMMIT');
    const updated = await query(`SELECT * FROM stock_counts WHERE id = $1 LIMIT 1`, [params.id]);
    return ok(updated[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
