export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid body', 400); }

  const soId = dto.so_id as string | undefined;
  if (!soId) return err('so_id is required', 400);

  // Load poultry tally sheet
  const tallyRows = await query<Record<string, unknown>>(
    `SELECT * FROM tally_sheets WHERE id = $1 LIMIT 1`, [params.id]);
  if (!tallyRows[0]) return err('Tally sheet not found', 404);
  const tally = tallyRows[0];
  if (tally.status !== 'posted') return err('Tally sheet must be posted', 400);

  // Load SO + company
  const soRows = await query<Record<string, unknown>>(
    `SELECT so.*, c.id AS cust_id FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = $1`,
    [soId]);
  if (!soRows[0]) return err('Sales order not found', 400);
  const so = soRows[0];
  if (!['approved', 'partially_delivered'].includes(so.status as string))
    return err(`Cannot create DR: SO is "${so.status}"`, 400);

  // Resolve warehouse from the tally sheet's own location (destination_id, else
  // branch_id). Never fall back to an arbitrary company warehouse — that
  // silently shipped the DR from the wrong farm.
  const branchId = (tally.destination_id ?? tally.branch_id) as string | null;
  if (!branchId) {
    return err('This tally sheet has no location set. Set its location before creating a delivery receipt.', 400);
  }
  const wh = await query<{ id: string }>(
    `SELECT id FROM warehouses WHERE branch_id = $1 AND company_id = $2 LIMIT 1`,
    [branchId, so.company_id],
  );
  const warehouseId = wh[0]?.id ?? null;
  if (!warehouseId) {
    return err('The tally sheet location has no linked warehouse. Add a warehouse for that location first.', 400);
  }

  // Load tally lines
  const tallyLines = await query<Record<string, unknown>>(
    `SELECT * FROM tally_sheet_lines WHERE tally_sheet_id = $1 ORDER BY id`, [params.id]);
  if (!tallyLines.length) return err('Tally sheet has no lines', 400);

  // SO lines for item matching
  const soLines = await query<{ id: string; item_id: string; quantity: string; qty_delivered: string }>(
    `SELECT id, item_id, quantity, qty_delivered FROM sales_order_lines WHERE order_id = $1`, [soId]);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
         WHERE company_id = $1 AND doc_type = $2 AND is_active = true
         RETURNING prefix, current_number`,
      [so.company_id, 'delivery_receipt']);
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for delivery_receipt', 400); }
    const drNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const deliveryDate = tally.transfer_date
      ? new Date(tally.transfer_date as string | Date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    // Ensure no FK constraint blocks setting tally_sheet_id
    await client.query(`ALTER TABLE delivery_receipts DROP CONSTRAINT IF EXISTS delivery_receipts_tally_sheet_id_fkey`).catch(() => {});

    const drRow = await client.query(
      `INSERT INTO delivery_receipts (company_id, branch_id, dr_no, so_id, customer_id, warehouse_id, delivery_date, tally_sheet_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) RETURNING id`,
      [so.company_id, branchId, drNo, soId, so.customer_id, warehouseId, deliveryDate, params.id, auth.userId]);
    const drId: string = drRow.rows[0].id as string;

    // Get avg costs
    const itemIds = tallyLines.map(l => l.item_id as string).filter(Boolean);
    const costRows = await client.query(
      `SELECT item_id, avg_cost FROM stock_balances WHERE item_id = ANY($1) AND warehouse_id = $2`,
      [itemIds, warehouseId]);
    const costMap = new Map((costRows.rows as Array<{ item_id: string; avg_cost: string }>)
      .map(r => [r.item_id, Number(r.avg_cost)]));

    // Insert DR lines from tally lines
    let lineNo = 1;
    for (const tl of tallyLines) {
      const itemId = tl.item_id as string | null;
      if (!itemId) continue;
      const qtyDelivered = Number(tl.net_kgs ?? 0);
      if (qtyDelivered <= 0) continue;
      const soLine = soLines.find(sl => sl.item_id === itemId);
      await client.query(
        `INSERT INTO delivery_receipt_lines (dr_id, so_line_id, line_no, item_id, description, qty_delivered, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [drId, soLine?.id ?? null, lineNo++, itemId, tl.remarks ?? '', qtyDelivered, costMap.get(itemId) ?? 0]);
    }

    await client.query('COMMIT');
    return ok({ dr_id: drId, dr_no: drNo });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message || 'Failed to create DR', 500);
  } finally {
    client.release();
  }
}
