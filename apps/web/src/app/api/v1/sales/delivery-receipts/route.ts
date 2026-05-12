export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `dr.company_id = $1`;

  const soId = searchParams.get('so_id');
  const status = searchParams.get('status');
  if (soId) { params.push(soId); where += ` AND dr.so_id = $${params.length}`; }
  if (status) { params.push(status); where += ` AND dr.status = $${params.length}`; }

  params.push(limit, offset);
  const rows = await query(
    `SELECT dr.id, dr.dr_no, dr.delivery_date, dr.status, dr.posted_at,
            c.name AS customer_name, so.order_no, w.name AS warehouse_name
       FROM delivery_receipts dr
       JOIN customers c ON c.id = dr.customer_id
       JOIN sales_orders so ON so.id = dr.so_id
       JOIN warehouses w ON w.id = dr.warehouse_id
      WHERE ${where}
      ORDER BY dr.delivery_date DESC, dr.dr_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM delivery_receipts dr WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows,
    total: countRows[0].c,
    page: Math.floor(offset / limit) + 1,
    page_size: limit,
  });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const lines = dto.lines as Array<Record<string, unknown>>;
  if (!lines?.length) return err('Delivery receipt must have at least one line', 400);

  const companyId = dto.company_id as string;
  const soId = dto.so_id as string;

  const soRows = await query(
    `SELECT so.*, c.id AS cust_id FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = $1 AND so.company_id = $2`,
    [soId, companyId],
  );
  if (!soRows[0]) return err('Sales order not found', 404);
  const so = soRows[0] as Record<string, unknown>;

  if (!['approved', 'partially_delivered'].includes(so.status as string)) {
    return err(`Cannot create DR for SO in status: ${so.status}`, 400);
  }

  const soLines = await query<{ id: string; item_id: string; quantity: string; qty_delivered: string }>(
    `SELECT id, item_id, quantity, qty_delivered FROM sales_order_lines WHERE order_id = $1`,
    [soId],
  );

  for (const drLine of lines as Array<Record<string, unknown>>) {
    if (drLine.so_line_id) {
      const soLine = soLines.find((l) => l.id === drLine.so_line_id);
      if (!soLine) return err(`SO line ${drLine.so_line_id} not found`, 400);
      const remaining = Number(soLine.quantity) - Number(soLine.qty_delivered);
      if (Number(drLine.qty_delivered) > remaining + 0.0001) {
        return err(`Qty to deliver (${drLine.qty_delivered}) exceeds remaining (${remaining.toFixed(4)})`, 400);
      }
    }
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now() WHERE company_id = $1 AND doc_type = $2 AND is_active = true RETURNING prefix, current_number, end_number`,
      [companyId, 'delivery_receipt'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for delivery_receipt', 400); }
    const drNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const itemIds = lines.map((l) => l.item_id as string);
    const stockRows = await client.query(
      `SELECT item_id, avg_cost FROM stock_balances WHERE item_id = ANY($1) AND warehouse_id = $2`,
      [itemIds, dto.warehouse_id],
    );
    const costMap = new Map(
      (stockRows.rows as Array<{ item_id: string; avg_cost: string }>).map((r) => [r.item_id, Number(r.avg_cost)]),
    );

    const headerRows = await client.query(
      `INSERT INTO delivery_receipts (company_id, branch_id, dr_no, so_id, customer_id, warehouse_id, delivery_date, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) RETURNING *`,
      [companyId, dto.branch_id ?? null, drNo, soId, so.customer_id, dto.warehouse_id, dto.delivery_date, dto.notes ?? null, auth.userId],
    );
    const header = headerRows.rows[0];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const unitCost = costMap.get(l.item_id as string) ?? 0;
      const itemRow = await client.query(`SELECT name FROM items WHERE id = $1 LIMIT 1`, [l.item_id]);
      await client.query(
        `INSERT INTO delivery_receipt_lines (dr_id, so_line_id, line_no, item_id, description, qty_delivered, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [header.id, l.so_line_id ?? null, i + 1, l.item_id, l.description ?? itemRow.rows[0]?.name ?? '', l.qty_delivered, unitCost],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'delivery_receipt', header.id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');

    const fullHeaders = await query(
      `SELECT dr.*, c.name AS customer_name, so.order_no, w.name AS warehouse_name FROM delivery_receipts dr JOIN customers c ON c.id = dr.customer_id JOIN sales_orders so ON so.id = dr.so_id JOIN warehouses w ON w.id = dr.warehouse_id WHERE dr.id = $1 LIMIT 1`,
      [header.id],
    );
    const drLines = await query(
      `SELECT drl.*, i.sku AS item_sku, i.name AS item_name FROM delivery_receipt_lines drl JOIN items i ON i.id = drl.item_id WHERE drl.dr_id = $1 ORDER BY drl.line_no`,
      [header.id],
    );

    return ok({
      ...fullHeaders[0],
      lines: drLines.map((l) => ({ ...l, qty_delivered: Number((l as Record<string, unknown>).qty_delivered), unit_cost: Number((l as Record<string, unknown>).unit_cost) })),
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
