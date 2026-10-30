export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Received stock transfers (with their lines) into a warehouse, available to
// put away. Lines show what is still left after draft/posted put-aways, and
// fully put-away transfers are left out, so the same stock can't be binned twice.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  const warehouseId = searchParams.get('warehouse_id');
  if (!companyId || !warehouseId) return err('company_id and warehouse_id are required', 400);

  const transfers = await query(
    `SELECT st.id, st.transfer_no, st.to_warehouse_id AS warehouse_id, st.received_at,
            fw.name AS from_warehouse_name
       FROM stock_transfers st
       JOIN warehouses fw ON fw.id = st.from_warehouse_id
      WHERE st.company_id = $1 AND st.to_warehouse_id = $2 AND st.status = 'received'
      ORDER BY st.received_at DESC, st.transfer_no DESC
      LIMIT 200`,
    [companyId, warehouseId],
  );
  if (!transfers.length) return ok([]);

  const lines = await query(
    `WITH sent AS (
       SELECT transfer_id, item_id, MIN(line_no) AS line_no, SUM(qty) AS qty,
              SUM(qty * COALESCE(unit_cost_at_send, 0)) / NULLIF(SUM(qty), 0) AS unit_cost
         FROM stock_transfer_lines
        WHERE transfer_id = ANY($1::uuid[])
        GROUP BY transfer_id, item_id
     ), used AS (
       SELECT p.transfer_id, pl.item_id, SUM(pl.qty) AS qty
         FROM putaway_lines pl JOIN putaways p ON p.id = pl.putaway_id
        WHERE p.transfer_id = ANY($1::uuid[]) AND p.status <> 'cancelled'
        GROUP BY p.transfer_id, pl.item_id
     )
     SELECT sent.transfer_id, sent.qty - COALESCE(used.qty, 0) AS qty, sent.unit_cost AS unit_cost_at_send,
            sent.item_id, i.sku, i.name AS item_name, i.uom, i.tracking_mode
       FROM sent
       JOIN items i ON i.id = sent.item_id
       LEFT JOIN used ON used.transfer_id = sent.transfer_id AND used.item_id = sent.item_id
      WHERE sent.qty - COALESCE(used.qty, 0) > 0
      ORDER BY sent.line_no`,
    [transfers.map((t) => t.id)],
  );

  const byTransfer = new Map<string, unknown[]>();
  for (const l of lines) {
    const arr = byTransfer.get(String(l.transfer_id)) ?? [];
    arr.push({
      item_id: l.item_id, sku: l.sku, item_name: l.item_name, uom: l.uom,
      tracking_mode: l.tracking_mode,
      qty: Number(l.qty), unit_cost: Number(l.unit_cost_at_send ?? 0),
    });
    byTransfer.set(String(l.transfer_id), arr);
  }

  return ok(transfers.filter((t) => byTransfer.has(String(t.id))).map((t) => ({ ...t, lines: byTransfer.get(String(t.id))! })));
}
