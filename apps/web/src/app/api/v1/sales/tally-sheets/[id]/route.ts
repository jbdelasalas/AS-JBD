export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(
    `SELECT st.*,
            c.name AS customer_name_live, c.code AS customer_code,
            c.address AS customer_address, c.payment_terms_days AS customer_terms,
            oa.allocation_no,
            br.code AS branch_code, br.name AS branch_name,
            fb.code AS building_code, fb.name AS building_name,
            cc.code AS cost_center_code, cc.name AS cost_center_name,
            gr.code AS grow_ref_code
       FROM sales_tally_sheets st
       JOIN customers c ON c.id = st.customer_id
       LEFT JOIN order_allocations oa ON oa.id = st.allocation_id
       LEFT JOIN branches br ON br.id = st.branch_id
       LEFT JOIN farm_buildings fb ON fb.id = st.building_id
       LEFT JOIN cost_centers cc ON cc.id = st.cost_center_id
       LEFT JOIN grow_references gr ON gr.id = st.grow_reference_id
      WHERE st.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err('Tally sheet not found', 404);

  const lines = await query(
    `SELECT tl.*, i.sku AS item_sku, i.name AS item_name
       FROM sales_tally_lines tl
       LEFT JOIN items i ON i.id = tl.item_id
      WHERE tl.tally_id = $1
      ORDER BY tl.line_no`,
    [params.id],
  );

  return ok({ ...rows[0], lines });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const dto = await request.json().catch(() => null);
  if (!dto) return err('Invalid body', 400);

  // Update tally line actual quantities
  if (Array.isArray(dto.lines)) {
    for (const l of dto.lines) {
      if (!l.id) continue;
      await query(
        `UPDATE sales_tally_lines
            SET actual_qty = $1, actual_weight_kgs = $2, remarks = $3
          WHERE id = $4`,
        [l.actual_qty ?? 0, l.actual_weight_kgs ?? 0, l.remarks ?? null, l.id],
      );
    }
  }

  if (dto.notes !== undefined) {
    await query(`UPDATE sales_tally_sheets SET notes = $1 WHERE id = $2`, [dto.notes, params.id]);
  }

  return ok({ id: params.id });
}
