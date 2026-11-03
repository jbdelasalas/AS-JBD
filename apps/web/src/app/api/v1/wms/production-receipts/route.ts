export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { DP_OUTPUT_PUTAWAY_ELIGIBLE } from '@/lib/wms';

// Dressing-plant batches with production output waiting to go into a warehouse,
// pack by pack: each production line (one weighing = one pack/crate) is put
// away on its own. Packs already on a draft/posted put-away are left out, so the
// same pack can't be binned twice. The put-away is what moves output from DP
// into the warehouse, so any warehouse can take it.
//
// A batch with an open put-away made before packs were tracked (lines without
// dp_output_id) is held back until that put-away is posted or cancelled.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const packs = await query(
    `SELECT po.id, po.job_order_id, jo.batch_no, c.name AS client_name,
            po.item_id, i.sku, i.name AS item_name, i.uom, i.tracking_mode,
            po.weight_kg - COALESCE(po.transferred_kg, 0) AS qty, po.head_count, po.pack_count,
            COALESCE(po.line_no, 0) AS pack_no
       FROM dp_processed_output po
       JOIN dp_job_orders jo ON jo.id = po.job_order_id
       JOIN dp_clients c ON c.id = jo.client_id
       JOIN items i ON i.id = po.item_id
      WHERE jo.company_id = $1 AND ${DP_OUTPUT_PUTAWAY_ELIGIBLE}
        AND po.weight_kg > COALESCE(po.transferred_kg, 0)
        AND NOT EXISTS (
          SELECT 1 FROM putaway_lines pl JOIN putaways p ON p.id = pl.putaway_id
           WHERE pl.dp_output_id = po.id AND p.status <> 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM putaway_lines pl JOIN putaways p ON p.id = pl.putaway_id
           WHERE p.job_order_id = po.job_order_id AND p.status = 'draft' AND pl.dp_output_id IS NULL)
      ORDER BY jo.batch_no DESC, po.line_no NULLS LAST, po.created_at, po.id`,
    [companyId],
  );

  const batches = new Map<string, { id: string; batch_no: string; client_name: string; packs: unknown[] }>();
  for (const p of packs) {
    const id = String(p.job_order_id);
    if (!batches.has(id)) batches.set(id, { id, batch_no: String(p.batch_no), client_name: String(p.client_name), packs: [] });
    batches.get(id)!.packs.push({
      id: p.id, pack_no: Number(p.pack_no), item_id: p.item_id, sku: p.sku, item_name: p.item_name, uom: p.uom,
      tracking_mode: p.tracking_mode, qty: Number(p.qty), heads: Number(p.head_count || 0), unit_cost: 0,
    });
  }
  return ok([...batches.values()]);
}
