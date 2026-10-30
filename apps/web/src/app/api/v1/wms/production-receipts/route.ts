export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { DP_OUTPUT_PUTAWAY_ELIGIBLE } from '@/lib/wms';

// Dressing-plant batches with production output waiting to go into a warehouse.
// The put-away is what moves it from DP into the warehouse, so any warehouse can
// take it. Lines show what is still left after draft/posted put-aways, and fully
// put-away batches are left out, so the same output can't be binned twice.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const lines = await query(
    `WITH made AS (
       SELECT po.job_order_id, po.item_id, SUM(po.weight_kg) AS qty, MAX(po.created_at) AS produced_at
         FROM dp_processed_output po
         JOIN dp_job_orders jo ON jo.id = po.job_order_id
        WHERE jo.company_id = $1 AND ${DP_OUTPUT_PUTAWAY_ELIGIBLE}
        GROUP BY po.job_order_id, po.item_id
     ), used AS (
       SELECT p.job_order_id, pl.item_id, SUM(pl.qty) AS qty
         FROM putaway_lines pl JOIN putaways p ON p.id = pl.putaway_id
        WHERE p.job_order_id IN (SELECT job_order_id FROM made) AND p.status <> 'cancelled'
        GROUP BY p.job_order_id, pl.item_id
     )
     SELECT made.job_order_id, jo.batch_no, c.name AS client_name, made.produced_at,
            made.qty - COALESCE(used.qty, 0) AS qty,
            made.item_id, i.sku, i.name AS item_name, i.uom, i.tracking_mode
       FROM made
       JOIN dp_job_orders jo ON jo.id = made.job_order_id
       JOIN dp_clients c ON c.id = jo.client_id
       JOIN items i ON i.id = made.item_id
       LEFT JOIN used ON used.job_order_id = made.job_order_id AND used.item_id = made.item_id
      WHERE made.qty - COALESCE(used.qty, 0) > 0
      ORDER BY made.produced_at DESC, i.name`,
    [companyId],
  );

  const batches = new Map<string, { id: string; batch_no: string; client_name: string; lines: unknown[] }>();
  for (const l of lines) {
    const id = String(l.job_order_id);
    if (!batches.has(id)) batches.set(id, { id, batch_no: String(l.batch_no), client_name: String(l.client_name), lines: [] });
    batches.get(id)!.lines.push({
      item_id: l.item_id, sku: l.sku, item_name: l.item_name, uom: l.uom,
      tracking_mode: l.tracking_mode, qty: Number(l.qty), unit_cost: 0,
    });
  }
  return ok([...batches.values()]);
}
