export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  // Load tally sheet with SO via allocation or direct so_id
  const tallyRows = await query<Record<string, unknown>>(
    `SELECT st.*,
            COALESCE(st.so_id, oa.so_id) AS effective_so_id,
            oa.so_id AS alloc_so_id
       FROM sales_tally_sheets st
       LEFT JOIN order_allocations oa ON oa.id = st.allocation_id
      WHERE st.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!tallyRows[0]) return err('Tally sheet not found', 404);
  const tally = tallyRows[0];

  if (tally.dr_id) return err('A delivery receipt has already been created from this tally sheet', 409);

  const soId = tally.effective_so_id as string | null;
  if (!soId) return err('No sales order linked to this tally sheet', 400);

  // Get SO + company info
  const soRows = await query<Record<string, unknown>>(
    `SELECT so.*, c.id AS cust_id FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = $1`,
    [soId],
  );
  if (!soRows[0]) return err('Sales order not found', 400);
  const so = soRows[0];

  if (!['approved', 'partially_delivered'].includes(so.status as string)) {
    return err(`Cannot create DR: SO is in status "${so.status}"`, 400);
  }

  // The DR must ship from the tally sheet's own location. Use the warehouse
  // linked to the tally sheet's branch — never fall back to an arbitrary
  // company warehouse (that silently shipped from the wrong farm).
  const branchId = tally.branch_id as string | null;
  if (!branchId) {
    return err('This tally sheet has no location set. Set its location before creating a delivery receipt.', 400);
  }
  const whRows = await query<{ id: string }>(
    `SELECT id FROM warehouses WHERE branch_id = $1 AND company_id = $2 LIMIT 1`,
    [branchId, so.company_id],
  );
  const warehouseId = whRows[0]?.id ?? null;
  if (!warehouseId) {
    return err('The tally sheet location has no linked warehouse. Add a warehouse for that location first.', 400);
  }

  // Tally lines
  const tallyLines = await query<Record<string, unknown>>(
    `SELECT * FROM sales_tally_lines WHERE tally_id = $1 ORDER BY line_no`, [params.id]);
  if (!tallyLines.length) return err('Tally sheet has no lines', 400);

  // SO lines for matching item_id → so_line_id
  const soLines = await query<{ id: string; item_id: string; quantity: string; qty_delivered: string }>(
    `SELECT id, item_id, quantity, qty_delivered FROM sales_order_lines WHERE order_id = $1`, [soId]);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Generate DR number
    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
         WHERE company_id = $1 AND doc_type = $2 AND is_active = true
         RETURNING prefix, current_number`,
      [so.company_id, 'delivery_receipt'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for delivery_receipt', 400); }
    const drNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const deliveryDate = (tally.delivery_date as string | null) ?? new Date().toISOString().split('T')[0];

    let drRows: { rows: Array<{ id: string; dr_no: string }> };
    try {
      drRows = await client.query(
        `INSERT INTO delivery_receipts
           (company_id, branch_id, dr_no, so_id, customer_id, warehouse_id,
            delivery_date, notes, status, tally_sheet_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10)
         RETURNING id, dr_no`,
        [so.company_id, branchId, drNo, soId, so.customer_id, warehouseId,
         deliveryDate, null, params.id, auth.userId],
      );
    } catch {
      // tally_sheet_id column not yet added — insert without it
      drRows = await client.query(
        `INSERT INTO delivery_receipts
           (company_id, branch_id, dr_no, so_id, customer_id, warehouse_id,
            delivery_date, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)
         RETURNING id, dr_no`,
        [so.company_id, branchId, drNo, soId, so.customer_id, warehouseId,
         deliveryDate, null, auth.userId],
      );
    }
    const drId = drRows.rows[0].id as string;
    const drNoResult = drRows.rows[0].dr_no as string;

    // Get avg costs for items
    const itemIds = tallyLines.map(l => l.item_id as string).filter(Boolean);
    const costRows = await client.query(
      `SELECT item_id, avg_cost FROM stock_balances WHERE item_id = ANY($1) AND warehouse_id = $2`,
      [itemIds, warehouseId],
    );
    const costMap = new Map((costRows.rows as Array<{ item_id: string; avg_cost: string }>)
      .map(r => [r.item_id, Number(r.avg_cost)]));

    // Create DR lines — match tally line to SO line by item_id
    for (let i = 0; i < tallyLines.length; i++) {
      const tl = tallyLines[i];
      const itemId = tl.item_id as string | null;
      if (!itemId) continue;

      // Use actual_weight_kgs if nonzero, otherwise actual_qty
      const actualKgs = Number(tl.actual_weight_kgs);
      const qtyDelivered = actualKgs > 0 ? actualKgs : Number(tl.actual_qty);
      if (qtyDelivered <= 0) continue;

      // Match to SO line by item_id
      const soLine = soLines.find(sl => sl.item_id === itemId);

      await client.query(
        `INSERT INTO delivery_receipt_lines
           (dr_id, so_line_id, line_no, item_id, description, qty_delivered, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [drId, soLine?.id ?? null, i + 1, itemId,
         tl.description ?? '', qtyDelivered, costMap.get(itemId) ?? 0],
      );
    }

    // Link DR back to tally sheet (column may not exist before migration)
    try {
      await client.query(
        `UPDATE sales_tally_sheets SET dr_id = $1 WHERE id = $2`,
        [drId, params.id],
      );
    } catch { /* migration pending — skip */ }

    await client.query('COMMIT');
    return ok({ dr_id: drId, dr_no: drNoResult });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
