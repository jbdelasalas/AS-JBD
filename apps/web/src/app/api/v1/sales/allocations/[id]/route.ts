export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(
    `SELECT oa.*,
            c.name AS customer_name_live, c.code AS customer_code,
            c.address AS customer_address, c.payment_terms_days AS customer_terms,
            so.order_no AS so_no,
            br.code AS branch_code, br.name AS branch_name,
            fb.code AS building_code, fb.name AS building_name,
            cc.code AS cost_center_code, cc.name AS cost_center_name,
            gr.code AS grow_ref_code, gr.name AS grow_ref_name
       FROM order_allocations oa
       JOIN customers c ON c.id = oa.customer_id
       LEFT JOIN sales_orders so ON so.id = oa.so_id
       LEFT JOIN branches br ON br.id = oa.branch_id
       LEFT JOIN farm_buildings fb ON fb.id = oa.building_id
       LEFT JOIN cost_centers cc ON cc.id = oa.cost_center_id
       LEFT JOIN grow_references gr ON gr.id = oa.grow_reference_id
      WHERE oa.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err('Allocation not found', 404);

  const lines = await query(
    `SELECT al.*, i.sku AS item_sku, i.name AS item_name, i.uom AS item_uom
       FROM order_allocation_lines al
       LEFT JOIN items i ON i.id = al.item_id
      WHERE al.allocation_id = $1
      ORDER BY al.line_no`,
    [params.id],
  );

  return ok({ ...rows[0], lines });
}
