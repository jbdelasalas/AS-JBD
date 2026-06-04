export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let rows: Record<string, unknown>[];
  try {
    rows = await query(
      `SELECT st.*,
              c.name AS customer_name_live, c.code AS customer_code,
              c.address AS customer_address, c.payment_terms_days AS customer_terms,
              oa.allocation_no,
              COALESCE(st.so_id, oa.so_id) AS effective_so_id,
              so.order_no AS so_no,
              br.code AS branch_code, br.name AS branch_name,
              fb.code AS building_code, fb.name AS building_name,
              cc.code AS cost_center_code, cc.name AS cost_center_name,
              gr.code AS grow_ref_code
         FROM sales_tally_sheets st
         JOIN customers c ON c.id = st.customer_id
         LEFT JOIN order_allocations oa ON oa.id = st.allocation_id
         LEFT JOIN sales_orders so ON so.id = COALESCE(st.so_id, oa.so_id)
         LEFT JOIN branches br ON br.id = st.branch_id
         LEFT JOIN farm_buildings fb ON fb.id = st.building_id
         LEFT JOIN cost_centers cc ON cc.id = st.cost_center_id
         LEFT JOIN grow_references gr ON gr.id = st.grow_reference_id
        WHERE st.id = $1 LIMIT 1`,
      [params.id],
    ) as Record<string, unknown>[];
  } catch {
    // so_id / dr_id columns not yet added (migration pending) — fall back without them
    rows = await query(
      `SELECT st.*,
              c.name AS customer_name_live, c.code AS customer_code,
              c.address AS customer_address, c.payment_terms_days AS customer_terms,
              oa.allocation_no, oa.so_id AS effective_so_id,
              so.order_no AS so_no,
              br.code AS branch_code, br.name AS branch_name,
              fb.code AS building_code, fb.name AS building_name,
              cc.code AS cost_center_code, cc.name AS cost_center_name,
              gr.code AS grow_ref_code
         FROM sales_tally_sheets st
         JOIN customers c ON c.id = st.customer_id
         LEFT JOIN order_allocations oa ON oa.id = st.allocation_id
         LEFT JOIN sales_orders so ON so.id = oa.so_id
         LEFT JOIN branches br ON br.id = st.branch_id
         LEFT JOIN farm_buildings fb ON fb.id = st.building_id
         LEFT JOIN cost_centers cc ON cc.id = st.cost_center_id
         LEFT JOIN grow_references gr ON gr.id = st.grow_reference_id
        WHERE st.id = $1 LIMIT 1`,
      [params.id],
    ) as Record<string, unknown>[];
  }
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

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid body', 400);
  }

  try {
    // Update tally line actual quantities
    const lines = dto.lines as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(lines)) {
      for (const l of lines) {
        if (!l.id) continue;
        await query(
          `UPDATE sales_tally_lines
              SET actual_qty = $1, actual_weight_kgs = $2, remarks = $3
            WHERE id = $4`,
          [Number(l.actual_qty ?? 0), Number(l.actual_weight_kgs ?? 0), l.remarks ?? null, l.id],
        );
      }
    }

    // Update header fields that were explicitly sent
    const headerSets: string[] = [];
    const headerVals: unknown[] = [];
    for (const col of ['notes', 'so_id', 'dr_id']) {
      if (Object.prototype.hasOwnProperty.call(dto, col)) {
        headerVals.push(dto[col] ?? null);
        headerSets.push(`${col} = $${headerVals.length}`);
      }
    }
    if (headerSets.length) {
      headerVals.push(params.id);
      await query(
        `UPDATE sales_tally_sheets SET ${headerSets.join(', ')} WHERE id = $${headerVals.length}`,
        headerVals,
      );
    }

    return ok({ id: params.id });
  } catch (e) {
    const msg = String((e as { message?: string })?.message || (e as { toString?: () => string })?.toString?.() || 'Failed to save tally sheet');
    return err(msg, 500);
  }
}
