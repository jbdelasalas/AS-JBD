export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { BOX_HELD_BY_PICK_SQL } from '@/lib/wms';

// Packs/crates in a warehouse that can go on a pick list: boxes from a
// production put-away (one per weighed pack), still in storage and not already
// held by another pick list. Oldest first (FIFO), then pack number.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  const warehouseId = searchParams.get('warehouse_id');
  if (!companyId || !warehouseId) return err('company_id and warehouse_id are required', 400);

  const rows = await query(
    `SELECT x.id, x.item_id, x.bin_id, b.code AS bin_code, x.lot_id, l.lot_no,
            x.net_weight_kg AS qty, COALESCE(po.head_count, 0) AS heads, po.line_no AS pack_no,
            jo.batch_no, x.time_in
       FROM dp_storage_boxes x
       JOIN dp_processed_output po ON po.id = x.dp_output_id
       LEFT JOIN bins b ON b.id = x.bin_id
       LEFT JOIN item_lots l ON l.id = x.lot_id
       LEFT JOIN dp_job_orders jo ON jo.id = x.job_order_id
      WHERE x.company_id = $1 AND x.warehouse_id = $2 AND x.status = 'in_storage'
        AND NOT ${BOX_HELD_BY_PICK_SQL('x.id')}
      ORDER BY x.time_in, jo.batch_no, po.line_no`,
    [companyId, warehouseId],
  );
  return ok(rows.map((r) => ({ ...r, qty: Number(r.qty), heads: Number(r.heads), pack_no: r.pack_no == null ? null : Number(r.pack_no) })));
}
