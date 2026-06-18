export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { adjustBinBalance, binQtyOnHand } from '@/lib/wms';

// Confirm a shipment: remove the goods from their bins.
//
// IMPORTANT — this only updates the bin-level sub-ledger (bin_stock_balances).
// The warehouse-level stock_balances total and the stock_movements accounting
// ledger (and the COGS GL entry) remain owned by the Delivery Receipt / Sales
// Invoice posting, exactly as before. WMS is a physical-location layer that
// reconciles to the books but never mutates them, so stock is never issued twice.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const [s] = await query(`SELECT * FROM shipments WHERE id = $1 LIMIT 1`, [params.id]);
  if (!s) return err('Shipment not found', 404);
  if (s.status !== 'draft') return err('Only draft shipments can be shipped', 400);

  const lines = await query(`SELECT * FROM shipment_lines WHERE shipment_id = $1`, [params.id]);
  if (!lines.length) return err('Shipment has no lines', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const l of lines) {
      const lotId = l.lot_id ? String(l.lot_id) : null;
      const avail = await binQtyOnHand(client, String(l.item_id), String(l.bin_id), lotId);
      const qty = Number(l.qty);
      if (qty > avail) throw new Error(`Bin only holds ${avail} for one of the lines (tried to ship ${qty})`);
      await adjustBinBalance(client, String(s.company_id), String(l.item_id), String(s.warehouse_id), String(l.bin_id), lotId, -qty, Number(l.unit_cost));
    }

    // Flag any serials sitting in these bins as shipped (best-effort, lot-aware).
    for (const l of lines) {
      await client.query(
        `UPDATE item_serials SET status='shipped', shipped_at=now()
          WHERE item_id=$1 AND bin_id=$2 AND status='in_stock'
            AND ($3::uuid IS NULL OR lot_id=$3)`,
        [l.item_id, l.bin_id, l.lot_id ?? null],
      );
    }

    await client.query(
      `UPDATE shipments SET status='shipped', shipped_at=now(), shipped_by=$1, updated_at=now() WHERE id=$2`,
      [auth.userId, params.id],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to ship', 400);
  } finally { client.release(); }

  const [updated] = await query(`SELECT * FROM shipments WHERE id = $1 LIMIT 1`, [params.id]);
  return ok(updated);
}
