export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  const status = searchParams.get('status') ?? 'available';
  const poId = searchParams.get('po_id');
  try {
    const params: unknown[] = [companyId, status];
    let poFilter = '';
    if (poId) { params.push(poId); poFilter = ` AND b.po_id = $${params.length}`; }
    const rows = await query(
      `SELECT b.*, i.name AS item_name, i.sku,
              gr.grn_no, gr.receipt_date AS grn_date,
              gr.branch_id        AS grn_branch_id,
              gr.building_id      AS grn_building_id,
              gr.grow_reference_id AS grn_grow_reference_id,
              po.po_no,
              po.branch_id        AS po_branch_id,
              po.building_id      AS po_building_id,
              po.grow_reference_id AS po_grow_reference_id
         FROM chick_batches b
         JOIN items i ON i.id = b.item_id
         LEFT JOIN goods_receipts gr ON gr.id = b.grn_id
         LEFT JOIN purchase_orders po ON po.id = b.po_id
        WHERE b.company_id = $1 AND b.status = $2${poFilter}
          AND i.uom ILIKE 'HEAD%'
        ORDER BY b.date_received DESC`,
      params,
    );
    return ok(rows);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
