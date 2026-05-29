export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }

  const [rec] = await query<{ status: string; company_id: string; transaction_date: string }>(
    `SELECT status, company_id, transaction_date FROM inventory_ins WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status !== 'saved') return err(`Cannot post from status: ${rec.status}`, 400);

  const lines = await query<Record<string, unknown>>(
    `SELECT * FROM inventory_in_lines WHERE inventory_in_id = $1`, [params.id]);
  if (!lines.length) return err('No lines to post', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const l of lines) {
      const net = Number(l.net_quantity ?? 0);
      if (net <= 0) continue;

      // Auto-generate batch_no if not set
      let batchNo = l.batch_no as string | null;
      if (!batchNo) {
        const yr = new Date(rec.transaction_date).getFullYear();
        const { rows: [cnt] } = await client.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM chick_batches WHERE company_id = $1`, [rec.company_id]);
        batchNo = `BATCH-${yr}-${String(cnt.c + 1).padStart(5, '0')}`;
        await client.query(`UPDATE inventory_in_lines SET batch_no = $1 WHERE id = $2`, [batchNo, l.id]);
      }

      // Create chick batch
      await client.query(
        `INSERT INTO chick_batches (company_id, batch_no, inventory_in_id, inv_line_id, item_id, heads_in, heads_available, date_received, status)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,'available') ON CONFLICT DO NOTHING`,
        [rec.company_id, batchNo, params.id, l.id, l.item_id, net, rec.transaction_date],
      );

      // Inventory ledger
      const warehouseRow = await client.query(`SELECT warehouse_id FROM inventory_ins WHERE id = $1`, [params.id]);
      const warehouseId = warehouseRow.rows[0]?.warehouse_id;

      // Get current balance
      const balRow = await client.query(
        `SELECT qty_heads, qty_kgs, avg_cost FROM poultry_inventory_balance
          WHERE company_id=$1 AND warehouse_id IS NOT DISTINCT FROM $2 AND item_id=$3 FOR UPDATE`,
        [rec.company_id, warehouseId, l.item_id],
      );
      const bal = balRow.rows[0] ?? { qty_heads: 0, qty_kgs: 0, avg_cost: 0 };
      const newHeads = Number(bal.qty_heads) + net;
      const unitCost = Number(l.unit_cost ?? 0);
      const newAvg = newHeads > 0 ? (Number(bal.qty_heads) * Number(bal.avg_cost) + net * unitCost) / newHeads : unitCost;

      await client.query(
        `INSERT INTO poultry_inventory_ledger (company_id, warehouse_id, item_id, movement_type, source_type, source_id, source_doc_no, transaction_date, heads_in, unit_cost, total_cost, balance_heads)
         SELECT $1,$2,$3,'in','inventory_in',$4,doc_no,$5,$6,$7,$8,$9 FROM inventory_ins WHERE id=$4`,
        [rec.company_id, warehouseId, l.item_id, params.id, rec.transaction_date, net, unitCost, net * unitCost, newHeads],
      );
      await client.query(
        `INSERT INTO poultry_inventory_balance (company_id, warehouse_id, item_id, qty_heads, avg_cost, last_updated)
         VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (company_id, warehouse_id, item_id) DO UPDATE SET qty_heads=$4, avg_cost=$5, last_updated=now()`,
        [rec.company_id, warehouseId, l.item_id, newHeads, newAvg],
      );
    }

    await client.query(`UPDATE inventory_ins SET status='posted', posted_by=$1, posted_at=now() WHERE id=$2`, [auth.userId, params.id]);
    await client.query('COMMIT');
    await query(`INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'post','inventory_in',$3)`,
      [auth.userId, rec.company_id, params.id]).catch(() => {});
    const [updated] = await query(`SELECT * FROM inventory_ins WHERE id = $1`, [params.id]);
    return ok(updated);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
