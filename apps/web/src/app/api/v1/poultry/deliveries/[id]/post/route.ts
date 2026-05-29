export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  const [rec] = await query<Record<string, unknown>>(`SELECT * FROM poultry_deliveries WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status !== 'saved') return err(`Cannot post from status: ${rec.status}`, 400);
  const lines = await query<Record<string, unknown>>(`SELECT * FROM poultry_delivery_lines WHERE delivery_id = $1`, [params.id]);
  if (!lines.length) return err('No lines to post', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const l of lines) {
      const outKgs = Number(l.kgs ?? 0);
      const outHeads = Number(l.heads ?? 0);
      if (outKgs <= 0 && outHeads <= 0) continue;

      const balRow = await client.query(
        `SELECT qty_heads, qty_kgs FROM poultry_inventory_balance
          WHERE company_id=$1 AND warehouse_id IS NOT DISTINCT FROM $2 AND item_id=$3 FOR UPDATE`,
        [rec.company_id, rec.warehouse_id, l.item_id],
      );
      const bal = balRow.rows[0];
      if (!bal || Number(bal.qty_kgs) < outKgs) { await client.query('ROLLBACK'); return err(`Insufficient inventory for item on line ${l.line_no}`, 400); }
      const newKgs = Number(bal.qty_kgs) - outKgs;
      const newHeads = Number(bal.qty_heads) - outHeads;

      await client.query(
        `INSERT INTO poultry_inventory_ledger (company_id, warehouse_id, item_id, movement_type, source_type, source_id, source_doc_no, transaction_date, heads_out, kgs_out, balance_heads, balance_kgs)
         SELECT $1,$2,$3,'out','delivery',$4,doc_no,$5,$6,$7,$8,$9 FROM poultry_deliveries WHERE id=$4`,
        [rec.company_id, rec.warehouse_id, l.item_id, params.id, rec.transaction_date, outHeads, outKgs, newHeads, newKgs],
      );
      await client.query(
        `INSERT INTO poultry_inventory_balance (company_id, warehouse_id, item_id, qty_heads, qty_kgs, last_updated) VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (company_id, warehouse_id, item_id) DO UPDATE SET qty_heads=$4, qty_kgs=$5, last_updated=now()`,
        [rec.company_id, rec.warehouse_id, l.item_id, newHeads, newKgs],
      );
    }
    await client.query(`UPDATE poultry_deliveries SET status='posted', posted_by=$1, posted_at=now() WHERE id=$2`, [auth.userId, params.id]);
    await client.query('COMMIT');
    const [updated] = await query(`SELECT * FROM poultry_deliveries WHERE id = $1`, [params.id]);
    return ok(updated);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
