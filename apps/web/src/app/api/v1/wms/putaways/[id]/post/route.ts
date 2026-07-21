export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { adjustBinBalance } from '@/lib/wms';

// Posting a put-away places the received quantity into its target bins.
// It updates ONLY the bin-level sub-ledger — the warehouse total was already
// incremented when the goods receipt posted, so we must not touch
// stock_balances / stock_movements again or the warehouse qty would double.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const [pa] = await query(`SELECT * FROM putaways WHERE id = $1 LIMIT 1`, [params.id]);
  if (!pa) return err('Put-away not found', 404);
  if (pa.status !== 'draft') return err('Only draft put-aways can be posted', 400);

  const lines = await query(`SELECT * FROM putaway_lines WHERE putaway_id = $1`, [params.id]);
  if (!lines.length) return err('Put-away has no lines', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const l of lines) {
      await adjustBinBalance(
        client, String(pa.company_id), String(l.item_id), String(pa.warehouse_id),
        String(l.bin_id), l.lot_id ? String(l.lot_id) : null,
        Number(l.qty), Number(l.unit_cost),
      );
    }
    await client.query(
      `UPDATE putaways SET status='posted', posted_at=now(), posted_by=$1, updated_at=now() WHERE id=$2`,
      [auth.userId, params.id],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to post put-away', 500);
  } finally { client.release(); }

  const [updated] = await query(`SELECT * FROM putaways WHERE id = $1 LIMIT 1`, [params.id]);
  return ok(updated);
}
