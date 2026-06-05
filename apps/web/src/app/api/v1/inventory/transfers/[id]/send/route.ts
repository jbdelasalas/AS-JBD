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
  if (xfr.status !== 'draft') return err(`Cannot send a ${xfr.status} transfer`, 400);

  const companyRows = await query<{ allow_negative_inventory: boolean }>(
    `SELECT allow_negative_inventory FROM companies WHERE id = $1`, [xfr.company_id],
  );
  const allowNegative = companyRows[0]?.allow_negative_inventory ?? false;

  const lines = await query(
    `SELECT stl.*, sb.qty_on_hand FROM stock_transfer_lines stl
     LEFT JOIN stock_balances sb ON sb.item_id = stl.item_id AND sb.warehouse_id = $2
     WHERE stl.transfer_id = $1`,
    [params.id, xfr.from_warehouse_id],
  );

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const l of lines) {
      const qty = Number(l.qty);
      const available = Number(l.qty_on_hand ?? 0);
      if (!allowNegative && available < qty - 0.0001) {
        await client.query('ROLLBACK');
        return err(`Insufficient stock for item ${l.item_id}: available ${available}, requested ${qty}. Enable "Allow Negative Inventory" in Administration to permit this.`, 400);
      }

      const avgCost = await client.query(
        `SELECT COALESCE(avg_cost, 0) AS avg_cost FROM stock_balances WHERE item_id = $1 AND warehouse_id = $2`,
        [l.item_id, xfr.from_warehouse_id],
      );
      const unitCost = Number(avgCost.rows[0]?.avg_cost ?? 0);

      // Lock unit cost on the transfer line
      await client.query(
        `UPDATE stock_transfer_lines SET unit_cost_at_send = $1 WHERE id = $2`,
        [unitCost, l.id],
      );

      // Deduct from source
      await client.query(
        `UPDATE stock_balances SET qty_on_hand = qty_on_hand - $1, last_movement_at = now()
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
          -qty, unitCost, qty * unitCost,
          params.id, xfr.transfer_no, `Transfer out → ${xfr.to_warehouse_id}`, auth.userId,
        ],
      );
    }

    await client.query(
      `UPDATE stock_transfers SET status='in_transit', sent_at=now(), sent_by=$1, updated_at=now() WHERE id=$2`,
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
