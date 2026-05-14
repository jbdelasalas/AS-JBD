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

  if (!['draft', 'in_transit'].includes(xfr.status as string)) {
    return err(`Cannot cancel a ${xfr.status} transfer`, 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // If in_transit, reverse the stock deduction from source
    if (xfr.status === 'in_transit') {
      const lines = await client.query(
        `SELECT * FROM stock_transfer_lines WHERE transfer_id = $1`, [params.id],
      );
      for (const l of lines.rows) {
        const qty = Number(l.qty);
        const unitCost = Number(l.unit_cost_at_send ?? 0);
        await client.query(
          `UPDATE stock_balances SET qty_on_hand = qty_on_hand + $1, last_movement_at = now()
            WHERE item_id = $2 AND warehouse_id = $3`,
          [qty, l.item_id, xfr.from_warehouse_id],
        );
        await client.query(
          `INSERT INTO stock_movements
             (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
              reference_type, reference_id, reference_no, notes, created_by)
           VALUES ($1,$2,$3,'transfer_out',$4,$5,$6,'stock_transfer',$7,$8,$9,$10)`,
          [
            xfr.company_id, l.item_id, xfr.from_warehouse_id,
            qty, unitCost, qty * unitCost,
            params.id, xfr.transfer_no, `CANCEL reversal of ${xfr.transfer_no}`, auth.userId,
          ],
        );
      }
    }

    await client.query(
      `UPDATE stock_transfers SET status='cancelled', updated_at=now() WHERE id=$1`, [params.id],
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
