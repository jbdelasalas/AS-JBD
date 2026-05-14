export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(`SELECT * FROM stock_transfers WHERE id = $1 LIMIT 1`, [params.id]);
  if (!rows[0]) return err('Transfer not found', 404);
  const xfr = rows[0] as Record<string, unknown>;
  if (xfr.status !== 'in_transit') return err('Transfer must be in_transit to receive', 400);

  const lines = await query(
    `SELECT * FROM stock_transfer_lines WHERE transfer_id = $1`, [params.id],
  );

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const l of lines) {
      const qty = Number(l.qty);
      const unitCost = Number(l.unit_cost_at_send ?? 0);

      // Upsert stock_balances at destination
      await client.query(
        `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (item_id, warehouse_id) DO UPDATE
           SET qty_on_hand = stock_balances.qty_on_hand + $3,
               avg_cost = CASE WHEN stock_balances.qty_on_hand + $3 > 0
                 THEN (stock_balances.qty_on_hand * stock_balances.avg_cost + $3 * $4) / (stock_balances.qty_on_hand + $3)
                 ELSE $4 END,
               last_movement_at = now()`,
        [l.item_id, xfr.to_warehouse_id, qty, unitCost],
      );

      await client.query(
        `INSERT INTO stock_movements
           (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_no, notes, created_by)
         VALUES ($1,$2,$3,'transfer_in',$4,$5,$6,'stock_transfer',$7,$8,$9,$10)`,
        [
          xfr.company_id, l.item_id, xfr.to_warehouse_id,
          qty, unitCost, qty * unitCost,
          params.id, xfr.transfer_no, `Transfer in ← ${xfr.from_warehouse_id}`, auth.userId,
        ],
      );
    }

    await client.query(
      `UPDATE stock_transfers SET status='received', received_at=now(), received_by=$1, updated_at=now() WHERE id=$2`,
      [auth.userId, params.id],
    );

    await client.query('COMMIT');
    const updated = await query(`SELECT * FROM stock_transfers WHERE id = $1 LIMIT 1`, [params.id]);
    return ok(updated[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
