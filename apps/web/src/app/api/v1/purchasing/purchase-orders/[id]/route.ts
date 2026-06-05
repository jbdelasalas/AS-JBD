export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return {
    ...r,
    subtotal: Number(r.subtotal),
    vat_amount: Number(r.vat_amount),
    total: Number(r.total),
  };
}

function mapLine(l: Record<string, unknown>) {
  return {
    ...l,
    quantity: Number(l.quantity),
    qty_received: Number(l.qty_received),
    unit_price: Number(l.unit_price),
    vat_rate: Number(l.vat_rate),
    line_total: Number(l.line_total),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const rows = await query(
    `SELECT po.*,
            s.name  AS supplier_name,  s.code AS supplier_code,
            s.address AS supplier_address, s.payment_terms_days AS supplier_terms,
            s.tin   AS supplier_tin,
            b.code  AS branch_code,    b.name  AS branch_name,
            fb.code AS building_code,  fb.name AS building_name,
            cc.code AS cost_center_code, cc.name AS cost_center_name,
            gr.code AS grow_ref_code,  gr.name AS grow_ref_name,
            cu.full_name AS created_by_name,
            au.full_name AS approved_by_name
       FROM purchase_orders po
       JOIN suppliers s      ON s.id  = po.supplier_id
       LEFT JOIN branches       b  ON b.id  = po.branch_id
       LEFT JOIN farm_buildings fb ON fb.id = po.building_id
       LEFT JOIN cost_centers   cc ON cc.id = po.cost_center_id
       LEFT JOIN grow_references gr ON gr.id = po.grow_reference_id
       LEFT JOIN users cu           ON cu.id = po.created_by
       LEFT JOIN users au           ON au.id = po.approved_by
      WHERE po.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Purchase order ${params.id} not found`, 404);

  const lines = await query(
    `SELECT pol.*,
            i.sku   AS item_sku,   i.name  AS item_name,   i.uom  AS item_uom,
            br.code AS branch_code,
            fb.code AS building_code,
            cc.code AS cost_center_code,
            gr.code AS grow_ref_code
       FROM purchase_order_lines pol
       LEFT JOIN items          i  ON i.id  = pol.item_id
       LEFT JOIN branches       br ON br.id = pol.branch_id
       LEFT JOIN farm_buildings fb ON fb.id = pol.building_id
       LEFT JOIN cost_centers   cc ON cc.id = pol.cost_center_id
       LEFT JOIN grow_references gr ON gr.id = pol.grow_reference_id
      WHERE pol.po_id = $1
      ORDER BY pol.line_no`,
    [params.id],
  );

  return ok({
    ...mapRow(rows[0] as Record<string, unknown>),
    lines: lines.map((l) => mapLine(l as Record<string, unknown>)),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  if (!auth.isSuperadmin) return err('Forbidden — admin only', 403);
  try {
    const [rec] = await query<{ id: string }>(`SELECT id FROM purchase_orders WHERE id = $1`, [params.id]);
    if (!rec) return err('Not found', 404);
    const [{ cnt }] = await query<{ cnt: number }>(
      `SELECT (SELECT count(*)::int FROM goods_receipts WHERE po_id=$1) +
              (SELECT count(*)::int FROM chick_batches   WHERE po_id=$1) AS cnt`,
      [params.id],
    );
    if (Number(cnt) > 0) return err('Cannot delete: linked goods receipts or chick batches exist', 409);
    await query(`DELETE FROM purchase_order_lines WHERE po_id = $1`, [params.id]);
    await query(`DELETE FROM purchase_orders      WHERE id   = $1`, [params.id]);
    return new Response(null, { status: 204 });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
