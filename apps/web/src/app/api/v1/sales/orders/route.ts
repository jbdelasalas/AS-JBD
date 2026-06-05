export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return {
    ...r,
    subtotal: Number(r.subtotal),
    vat_amount: Number(r.vat_amount),
    total: Number(r.total),
    discount_pct: Number(r.discount_pct ?? 0),
  };
}

function mapLine(l: Record<string, unknown>) {
  return {
    ...l,
    quantity: Number(l.quantity),
    qty_delivered: Number(l.qty_delivered),
    qty_reserved: Number(l.qty_reserved ?? 0),
    unit_price: Number(l.unit_price),
    discount_pct: Number(l.discount_pct ?? 0),
    vat_rate: Number(l.vat_rate),
    line_subtotal: Number(l.line_subtotal ?? 0),
    line_vat: Number(l.line_vat ?? 0),
    line_total: Number(l.line_total),
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `so.company_id = $1`;

  const status = searchParams.get('status');
  const customerId = searchParams.get('customer_id');
  if (status) { params.push(status); where += ` AND so.status = $${params.length}`; }
  if (customerId) { params.push(customerId); where += ` AND so.customer_id = $${params.length}`; }

  params.push(limit, offset);
  const rows = await query(
    `SELECT so.id, so.order_no, so.order_date, so.delivery_date,
            so.subtotal, so.vat_amount, so.total, so.status,
            so.credit_checked, so.approved_at, so.created_at,
            c.name AS customer_name, c.code AS customer_code
       FROM sales_orders so
       JOIN customers c ON c.id = so.customer_id
      WHERE ${where}
      ORDER BY so.order_date DESC, so.order_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM sales_orders so WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows.map((r) => mapRow(r as Record<string, unknown>)),
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
  if (!lines?.length) return err('Sales order must have at least one line', 400);

  const companyId = dto.company_id as string;
  const customerId = dto.customer_id as string;

  const customers = await query<{ id: string; credit_limit: string; payment_terms_days: number }>(
    `SELECT id, credit_limit, payment_terms_days FROM customers WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [customerId, companyId],
  );
  if (!customers[0]) return err('Customer not found or inactive', 404);

  const itemIds = lines.map((l) => l.item_id as string);
  const items = await query<{ id: string; name: string; selling_price: string; is_active: boolean }>(
    `SELECT id, name, selling_price, is_active FROM items WHERE id = ANY($1) AND company_id = $2`,
    [itemIds, companyId],
  );
  if (items.length !== itemIds.length) return err('One or more items not found in this company', 400);
  const inactive = items.filter((i) => !i.is_active);
  if (inactive.length) return err(`Inactive items: ${inactive.map((i) => i.name).join(', ')}`, 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now() WHERE company_id = $1 AND doc_type = $2 AND is_active = true RETURNING prefix, current_number, end_number`,
      [companyId, 'sales_order'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for sales_order', 400); }
    const { prefix, current_number, end_number } = seriesRows.rows[0];
    const n = Number(current_number);
    if (end_number !== null && n > Number(end_number)) { await client.query('ROLLBACK'); return err('Document series sales_order exhausted', 400); }
    const orderNo = `${prefix}${String(n).padStart(6, '0')}`;

    const terms = (dto.payment_terms_days as number) ?? customers[0].payment_terms_days ?? 30;
    const mappedLines: Array<Record<string, unknown> & { line_no: number; vatRate: number; disc: number; subtotal: number; vat: number; total: number }> = lines.map((l, idx) => {
      const vatRate = Number(l.vat_rate ?? 12);
      const disc = Number(l.discount_pct ?? 0);
      const subtotal = parseFloat((Number(l.quantity) * Number(l.unit_price) * (1 - disc / 100)).toFixed(2));
      const vat = parseFloat((subtotal * (vatRate / 100)).toFixed(2));
      return { ...l, line_no: idx + 1, vatRate, disc, subtotal, vat, total: subtotal + vat };
    });

    const totSubtotal = mappedLines.reduce((s, l) => s + l.subtotal, 0);
    const totVat = mappedLines.reduce((s, l) => s + l.vat, 0);
    const totTotal = mappedLines.reduce((s, l) => s + l.total, 0);

    const headerRows = await client.query(
      `INSERT INTO sales_orders (company_id, branch_id, order_no, customer_id, order_date, delivery_date, warehouse_id, payment_terms_days, discount_pct, reference, notes, subtotal, vat_amount, total, status, created_by, building_id, cost_center_id, grow_reference_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,$16,$17,$18) RETURNING *`,
      [
        companyId, dto.branch_id ?? null, orderNo, customerId,
        dto.order_date, dto.delivery_date ?? null, dto.warehouse_id ?? null,
        terms, dto.discount_pct ?? 0, dto.reference ?? null, dto.notes ?? null,
        totSubtotal.toFixed(2), totVat.toFixed(2), totTotal.toFixed(2), auth.userId,
        dto.building_id ?? null, dto.cost_center_id ?? null, dto.grow_reference_id ?? null,
      ],
    );
    const header = headerRows.rows[0];

    for (const l of mappedLines) {
      const itemRow = items.find((i) => i.id === l.item_id);
      await client.query(
        `INSERT INTO sales_order_lines (order_id, line_no, item_id, description, quantity, qty_delivered, qty_reserved, unit_price, discount_pct, vat_rate, line_subtotal, line_vat, line_total, branch_id, building_id, cost_center_id, grow_reference_id)
         VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          header.id, l.line_no, l.item_id,
          l.description ?? itemRow?.name ?? '',
          l.quantity, l.unit_price, l.disc, l.vatRate,
          l.subtotal.toFixed(2), l.vat.toFixed(2), l.total.toFixed(2),
          (l as Record<string,unknown>).branch_id ?? null,
          (l as Record<string,unknown>).building_id ?? null,
          (l as Record<string,unknown>).cost_center_id ?? null,
          (l as Record<string,unknown>).grow_reference_id ?? null,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'sales_order', header.id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');

    const fullHeaders = await query(
      `SELECT so.*, c.name AS customer_name, c.code AS customer_code, c.credit_limit, c.payment_terms_days AS customer_terms
         FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = $1 LIMIT 1`,
      [header.id],
    );
    const soLines = await query(
      `SELECT sol.*, i.sku AS item_sku, i.name AS item_name FROM sales_order_lines sol JOIN items i ON i.id = sol.item_id WHERE sol.order_id = $1 ORDER BY sol.line_no`,
      [header.id],
    );

    return ok({
      ...mapRow(fullHeaders[0] as Record<string, unknown>),
      lines: soLines.map((l) => mapLine(l as Record<string, unknown>)),
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
