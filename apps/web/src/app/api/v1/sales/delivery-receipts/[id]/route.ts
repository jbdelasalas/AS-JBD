export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const [dr] = await query<{ status: string; company_id: string; so_id: string }>(
    `SELECT status, company_id, so_id FROM delivery_receipts WHERE id = $1`, [params.id]);
  if (!dr) return err('Not found', 404);

  // Allow tally_sheet linking on posted DRs; all other edits require draft
  const tallyOnlyPatch = ('tally_sheet_id' in dto || 'tally_sheet_no' in dto) &&
    !('delivery_date' in dto) && !('warehouse_id' in dto) && !('notes' in dto) && !('lines' in dto);
  if (dr.status !== 'draft' && !tallyOnlyPatch) return err('Only draft delivery receipts can be edited', 409);

  const lines = dto.lines as Array<Record<string, unknown>> | undefined;

  // Validate line quantities don't exceed remaining SO qty
  if (lines?.length) {
    const soLines = await query<{ id: string; quantity: string; qty_delivered: string }>(
      `SELECT sol.id, sol.quantity, sol.qty_delivered
         FROM sales_order_lines sol WHERE sol.order_id = $1`, [dr.so_id]);
    // Current DR lines' contribution to qty_delivered
    const prevLines = await query<{ so_line_id: string | null; qty_delivered: string }>(
      `SELECT so_line_id, qty_delivered FROM delivery_receipt_lines WHERE dr_id = $1`, [params.id]);
    const prevMap = new Map(prevLines.map(l => [l.so_line_id, Number(l.qty_delivered)]));

    for (const l of lines) {
      const soLineId = l.so_line_id as string | null;
      if (!soLineId) continue;
      const soLine = soLines.find(s => s.id === soLineId);
      if (!soLine) continue;
      const prevQty = prevMap.get(soLineId) ?? 0;
      const remaining = Number(soLine.quantity) - Number(soLine.qty_delivered) + prevQty;
      if (Number(l.qty_delivered) > remaining + 0.0001) {
        return err(`Qty (${l.qty_delivered}) exceeds remaining (${remaining.toFixed(4)}) for this SO line`, 400);
      }
    }
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Ensure no FK blocks tally_sheet_id updates (migration 022 may not have run)
    await client.query(`ALTER TABLE delivery_receipts DROP CONSTRAINT IF EXISTS delivery_receipts_tally_sheet_id_fkey`).catch(() => {});

    // Resolve tally_sheet_id: accept UUID directly or look up by ts_no
    let tallySheetId: string | null | undefined = undefined; // undefined = don't change
    if ('tally_sheet_id' in dto) {
      tallySheetId = (dto.tally_sheet_id as string | null) || null;
    } else if (dto.tally_sheet_no) {
      const tsRow = await client.query(
        `SELECT id FROM tally_sheets WHERE doc_no = $1 LIMIT 1`, [dto.tally_sheet_no]);
      tallySheetId = tsRow.rows[0]?.id ?? null;
    }

    await client.query(
      `UPDATE delivery_receipts SET
         delivery_date  = COALESCE($2, delivery_date),
         warehouse_id   = COALESCE($3, warehouse_id),
         notes          = $4,
         tally_sheet_id = CASE WHEN $5::boolean THEN $6::uuid ELSE tally_sheet_id END,
         updated_at     = now()
       WHERE id = $1`,
      [params.id, dto.delivery_date ?? null, dto.warehouse_id ?? null, dto.notes ?? null,
       tallySheetId !== undefined, tallySheetId ?? null],
    );

    if (lines !== undefined) {
      await client.query(`DELETE FROM delivery_receipt_lines WHERE dr_id = $1`, [params.id]);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const itemRow = await client.query(`SELECT name FROM items WHERE id = $1 LIMIT 1`, [l.item_id]);
        await client.query(
          `INSERT INTO delivery_receipt_lines (dr_id, so_line_id, line_no, item_id, description, qty_delivered, unit_cost)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [params.id, l.so_line_id ?? null, i + 1, l.item_id,
           l.description ?? itemRow.rows[0]?.name ?? '', l.qty_delivered, l.unit_cost ?? 0],
        );
      }
    }

    await client.query('COMMIT');
    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'update','delivery_receipt',$3)`,
      [auth.userId, dr.company_id, params.id],
    ).catch(() => {});
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }

  // Return updated record (re-use existing GET logic)
  const [updated] = await query(
    `SELECT dr.*, c.name AS customer_name, c.payment_terms_days,
            so.order_no, so.id AS so_id, w.name AS warehouse_name,
            COALESCE(dr.branch_id, so.branch_id) AS eff_branch_id,
            so.building_id AS eff_building_id, so.cost_center_id AS eff_cost_center_id,
            so.grow_reference_id AS eff_grow_reference_id
       FROM delivery_receipts dr
       JOIN customers c ON c.id = dr.customer_id
       JOIN sales_orders so ON so.id = dr.so_id
       JOIN warehouses w ON w.id = dr.warehouse_id
      WHERE dr.id = $1 LIMIT 1`, [params.id]);
  const updatedLines = await query(
    `SELECT drl.*, i.sku AS item_sku, i.name AS item_name, i.uom AS item_uom,
            sol.unit_price AS so_unit_price, sol.vat_rate AS so_vat_rate, sol.discount_pct AS so_discount_pct
       FROM delivery_receipt_lines drl
       JOIN items i ON i.id = drl.item_id
       LEFT JOIN sales_order_lines sol ON sol.id = drl.so_line_id
      WHERE drl.dr_id = $1 ORDER BY drl.line_no`, [params.id]);
  return ok({
    ...updated,
    lines: updatedLines.map(l => ({
      ...l,
      qty_delivered: Number((l as Record<string, unknown>).qty_delivered),
      unit_cost: Number((l as Record<string, unknown>).unit_cost),
    })),
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const [dr] = await query<{ status: string; company_id: string }>(
    `SELECT status, company_id FROM delivery_receipts WHERE id = $1`, [params.id]);
  if (!dr) return err('Not found', 404);
  if (dr.status !== 'draft') return err('Only draft delivery receipts can be deleted', 409);

  await query(`DELETE FROM delivery_receipt_lines WHERE dr_id = $1`, [params.id]);
  await query(`DELETE FROM delivery_receipts WHERE id = $1`, [params.id]);
  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'delete','delivery_receipt',$3)`,
    [auth.userId, dr.company_id, params.id],
  ).catch(() => {});

  return new Response(null, { status: 204 });
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

  let headers: Record<string, unknown>[];
  try {
    headers = await query(
      `SELECT dr.*,
              c.name AS customer_name, c.payment_terms_days,
              so.order_no, so.id AS so_id,
              COALESCE(dr.branch_id, so.branch_id)           AS eff_branch_id,
              COALESCE(dr.building_id, so.building_id)       AS eff_building_id,
              COALESCE(dr.cost_center_id, so.cost_center_id) AS eff_cost_center_id,
              COALESCE(dr.grow_reference_id, so.grow_reference_id) AS eff_grow_reference_id,
              w.name AS warehouse_name,
              ts.doc_no AS tally_doc_no
         FROM delivery_receipts dr
         JOIN customers c ON c.id = dr.customer_id
         JOIN sales_orders so ON so.id = dr.so_id
         JOIN warehouses w ON w.id = dr.warehouse_id
         LEFT JOIN tally_sheets ts ON ts.id = dr.tally_sheet_id
        WHERE dr.id = $1 LIMIT 1`,
      [params.id],
    ) as Record<string, unknown>[];
  } catch {
    // building_id / cost_center_id / grow_reference_id may not exist on delivery_receipts yet
    headers = await query(
      `SELECT dr.*,
              c.name AS customer_name, c.payment_terms_days,
              so.order_no, so.id AS so_id,
              COALESCE(dr.branch_id, so.branch_id) AS eff_branch_id,
              so.building_id    AS eff_building_id,
              so.cost_center_id AS eff_cost_center_id,
              so.grow_reference_id AS eff_grow_reference_id,
              w.name AS warehouse_name
         FROM delivery_receipts dr
         JOIN customers c ON c.id = dr.customer_id
         JOIN sales_orders so ON so.id = dr.so_id
         JOIN warehouses w ON w.id = dr.warehouse_id
        WHERE dr.id = $1 LIMIT 1`,
      [params.id],
    ) as Record<string, unknown>[];
  }
  if (!headers[0]) return err(`Delivery receipt ${params.id} not found`, 404);

  let lines: Record<string, unknown>[];
  try {
    lines = await query(
      `SELECT drl.*, i.sku AS item_sku, i.name AS item_name, i.uom AS item_uom,
              sol.unit_price AS so_unit_price, sol.vat_rate AS so_vat_rate,
              sol.discount_pct AS so_discount_pct
         FROM delivery_receipt_lines drl
         JOIN items i ON i.id = drl.item_id
         LEFT JOIN sales_order_lines sol ON sol.id = drl.so_line_id
        WHERE drl.dr_id = $1
        ORDER BY drl.line_no`,
      [params.id],
    ) as Record<string, unknown>[];
  } catch {
    lines = await query(
      `SELECT drl.*, i.sku AS item_sku, i.name AS item_name
         FROM delivery_receipt_lines drl
         JOIN items i ON i.id = drl.item_id
        WHERE drl.dr_id = $1
        ORDER BY drl.line_no`,
      [params.id],
    ) as Record<string, unknown>[];
  }

  return ok({
    ...headers[0],
    lines: lines.map((l) => ({
      ...l,
      qty_delivered: Number((l as Record<string, unknown>).qty_delivered),
      unit_cost: Number((l as Record<string, unknown>).unit_cost),
    })),
  });
}
