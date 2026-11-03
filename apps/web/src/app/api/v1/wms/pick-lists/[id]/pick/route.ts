export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { binQtyOnHand } from '@/lib/wms';

// Confirm picking. Picking is scan-checked: a pack counts only once its label
// was scanned in its bin (unscanned packs are left off, picked 0, and free for
// another pick list), and loose stock needs its bin scanned. This records what
// was picked and checks the stock is actually in the named bins, but does NOT
// move inventory — the single stock event happens
// at ship, so bin balances stay reconciled to the warehouse total until then.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const body = await request.json().catch(() => ({}));
  const picked = (body.lines as Array<{ id: string; qty_picked: number }> | undefined) ?? [];
  const pickedById = new Map(picked.map((p) => [p.id, Number(p.qty_picked)]));

  const [pl] = await query(`SELECT * FROM pick_lists WHERE id = $1 LIMIT 1`, [params.id]);
  if (!pl) return err('Pick list not found', 404);
  if (!['draft', 'picking'].includes(String(pl.status))) return err('Pick list cannot be picked in its current status', 400);

  const lines = await query(`SELECT * FROM pick_list_lines WHERE pick_id = $1`, [params.id]);
  if (!lines.length) return err('Pick list has no lines', 400);

  const unscannedBins = await query(
    `SELECT DISTINCT b.code FROM pick_list_lines pl JOIN bins b ON b.id = pl.bin_id
      WHERE pl.pick_id = $1 AND pl.box_id IS NULL AND pl.bin_scanned_at IS NULL ORDER BY b.code`, [params.id]);
  if (unscannedBins.length) return err(`Scan bin ${unscannedBins.map((b) => b.code).join(', ')} before confirming`, 400);
  if (!lines.some((l) => !l.box_id || l.box_scanned_at)) return err('No packs have been scanned yet', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const l of lines) {
      const qty = l.box_id
        ? (l.box_scanned_at ? Number(l.qty_to_pick) : 0)
        : pickedById.has(String(l.id)) ? pickedById.get(String(l.id))! : Number(l.qty_to_pick);
      if (qty < 0) throw new Error('Picked qty cannot be negative');
      // The to-pick qty is what the sales order allowed; picking more would ship beyond the order.
      if (qty > Number(l.qty_to_pick) + 1e-9) throw new Error(`Picked qty (${qty}) is more than the qty to pick (${Number(l.qty_to_pick)}) for one of the lines`);
      const avail = await binQtyOnHand(client, String(l.item_id), String(l.bin_id), l.lot_id ? String(l.lot_id) : null);
      if (qty > avail) throw new Error(`Bin only holds ${avail} for one of the lines (tried to pick ${qty})`);
      await client.query(`UPDATE pick_list_lines SET qty_picked = $1 WHERE id = $2`, [qty, l.id]);
    }
    await client.query(
      `UPDATE pick_lists SET status='picked', picked_at=now(), picked_by=$1, updated_at=now() WHERE id=$2`,
      [auth.userId, params.id],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to confirm pick', 400);
  } finally { client.release(); }

  const [updated] = await query(`SELECT * FROM pick_lists WHERE id = $1 LIMIT 1`, [params.id]);
  return ok(updated);
}
