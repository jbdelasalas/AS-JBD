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
    amount_paid: Number(r.amount_paid),
    balance: Number(r.balance),
    discount_amount: Number(r.discount_amount ?? 0),
  };
}

function mapLine(l: Record<string, unknown>) {
  return {
    ...l,
    quantity: Number(l.quantity),
    unit_price: Number(l.unit_price),
    discount_pct: Number(l.discount_pct ?? 0),
    vat_rate: Number(l.vat_rate),
    line_subtotal: Number(l.line_subtotal),
    line_vat: Number(l.line_vat),
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

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `si.company_id = $1`;

  const status = searchParams.get('status');
  const customerId = searchParams.get('customer_id');
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');

  if (status) { params.push(status); where += ` AND si.status = $${params.length}`; }
  if (customerId) { params.push(customerId); where += ` AND si.customer_id = $${params.length}`; }
  if (fromDate) { params.push(fromDate); where += ` AND si.invoice_date >= $${params.length}`; }
  if (toDate) { params.push(toDate); where += ` AND si.invoice_date <= $${params.length}`; }

  params.push(limit, offset);
  const rows = await query(
    `SELECT si.id, si.invoice_no, si.invoice_date, si.due_date,
            si.subtotal, si.vat_amount, si.total, si.amount_paid, si.balance, si.status,
            c.name AS customer_name, c.code AS customer_code
       FROM sales_invoices si
       JOIN customers c ON c.id = si.customer_id
      WHERE ${where}
      ORDER BY si.invoice_date DESC, si.invoice_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM sales_invoices si WHERE ${where}`,
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
  if (!lines?.length) return err('Invoice must have at least one line', 400);

  const companyId = dto.company_id as string;
  const customerId = dto.customer_id as string;

  const customers = await query<{ id: string; payment_terms_days: number }>(
    `SELECT id, payment_terms_days FROM customers WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [customerId, companyId],
  );
  if (!customers[0]) return err('Customer not found or inactive', 404);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Get doc number
    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = $2 AND is_active = true
        RETURNING prefix, current_number`,
      [companyId, 'sales_invoice'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for sales_invoice', 400); }
    const invoiceNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const terms = (dto.payment_terms_days as number) ?? customers[0].payment_terms_days ?? 30;
    const mappedLines: Array<Record<string, unknown> & { line_no: number; vatRate: number; disc: number; subtotal: number; vat: number; total: number }> = (lines as Array<Record<string, unknown>>).map((l, idx) => {
      const vatRate = Number(l.vat_rate ?? 12);
      const disc = Number(l.discount_pct ?? 0);
      const subtotal = parseFloat((Number(l.quantity) * Number(l.unit_price) * (1 - disc / 100)).toFixed(2));
      const vat = parseFloat((subtotal * (vatRate / 100)).toFixed(2));
      return { ...l, line_no: idx + 1, vatRate, disc, subtotal, vat, total: subtotal + vat };
    });

    const totSubtotal = mappedLines.reduce((s, l) => s + l.subtotal, 0);
    const totVat = mappedLines.reduce((s, l) => s + l.vat, 0);
    const totTotal = mappedLines.reduce((s, l) => s + l.total, 0);
    const dueDate = new Date(dto.invoice_date as string);
    dueDate.setDate(dueDate.getDate() + terms);

    const headerRows = await client.query(
      `INSERT INTO sales_invoices
         (company_id, branch_id, invoice_no, customer_id, so_id, dr_id,
          invoice_date, due_date, payment_terms_days, reference, notes,
          subtotal, vat_amount, total, amount_paid, balance, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,$14,'draft',$15)
       RETURNING *`,
      [
        companyId, dto.branch_id ?? null, invoiceNo, customerId,
        dto.so_id ?? null, dto.dr_id ?? null,
        dto.invoice_date, dueDate.toISOString().split('T')[0], terms,
        dto.reference ?? null, dto.notes ?? null,
        totSubtotal.toFixed(2), totVat.toFixed(2), totTotal.toFixed(2), auth.userId,
      ],
    );
    const header = headerRows.rows[0];

    for (const l of mappedLines) {
      await client.query(
        `INSERT INTO sales_invoice_lines
           (invoice_id, line_no, item_id, description, quantity, unit_price,
            discount_pct, vat_rate, line_subtotal, line_vat, line_total, revenue_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          header.id, l.line_no, l.item_id ?? null, l.description,
          l.quantity, l.unit_price, l.disc, l.vatRate,
          l.subtotal.toFixed(2), l.vat.toFixed(2), l.total.toFixed(2),
          l.revenue_account_id ?? null,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'sales_invoice', header.id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');

    // Fetch full invoice
    const fullHeaders = await query(
      `SELECT si.*, c.name AS customer_name, c.code AS customer_code, so.order_no, dr.dr_no
         FROM sales_invoices si
         JOIN customers c ON c.id = si.customer_id
         LEFT JOIN sales_orders so ON so.id = si.so_id
         LEFT JOIN delivery_receipts dr ON dr.id = si.dr_id
        WHERE si.id = $1 LIMIT 1`,
      [header.id],
    );
    const invoiceLines = await query(
      `SELECT sil.*, i.sku AS item_sku, i.name AS item_name
         FROM sales_invoice_lines sil
         LEFT JOIN items i ON i.id = sil.item_id
        WHERE sil.invoice_id = $1
        ORDER BY sil.line_no`,
      [header.id],
    );

    return ok({
      ...mapRow(fullHeaders[0] as Record<string, unknown>),
      lines: invoiceLines.map((l) => mapLine(l as Record<string, unknown>)),
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
