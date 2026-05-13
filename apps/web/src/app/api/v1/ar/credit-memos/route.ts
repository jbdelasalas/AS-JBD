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
    amount_applied: Number(r.amount_applied),
    unapplied_amount: Number(r.unapplied_amount),
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
  let where = `cm.company_id = $1`;

  const status = searchParams.get('status');
  const customerId = searchParams.get('customer_id');
  if (status) { params.push(status); where += ` AND cm.status = $${params.length}`; }
  if (customerId) { params.push(customerId); where += ` AND cm.customer_id = $${params.length}`; }

  params.push(limit, offset);
  const rows = await query(
    `SELECT cm.id, cm.cm_no, cm.cm_date, cm.total, cm.amount_applied,
            cm.unapplied_amount, cm.status, c.name AS customer_name,
            si.invoice_no AS original_invoice_no
       FROM ar_credit_memos cm
       JOIN customers c ON c.id = cm.customer_id
       LEFT JOIN sales_invoices si ON si.id = cm.original_invoice_id
      WHERE ${where}
      ORDER BY cm.cm_date DESC, cm.cm_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM ar_credit_memos cm WHERE ${where}`,
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
  if (!lines?.length) return err('Credit memo must have at least one line', 400);

  const companyId = dto.company_id as string;
  const customerId = dto.customer_id as string;

  const customers = await query(
    `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [customerId, companyId],
  );
  if (!customers[0]) return err('Customer not found or inactive', 404);

  if (dto.original_invoice_id) {
    const invRows = await query<{ id: string; status: string; customer_id: string }>(
      `SELECT id, status, customer_id FROM sales_invoices WHERE id = $1`,
      [dto.original_invoice_id],
    );
    if (!invRows[0]) return err('Original invoice not found', 404);
    if (invRows[0].customer_id !== customerId) return err('Invoice belongs to a different customer', 400);
    if (invRows[0].status === 'cancelled') return err('Cannot create credit memo against cancelled invoice', 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now() WHERE company_id = $1 AND doc_type = $2 AND is_active = true RETURNING prefix, current_number`,
      [companyId, 'credit_memo'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for credit_memo', 400); }
    const cmNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const mappedLines: Array<Record<string, unknown> & { line_no: number; vatRate: number; subtotal: number; vat: number; total: number }> = (lines as Array<Record<string, unknown>>).map((l, idx) => {
      const vatRate = Number(l.vat_rate ?? 12);
      const subtotal = parseFloat((Number(l.quantity) * Number(l.unit_price)).toFixed(2));
      const vat = parseFloat((subtotal * (vatRate / 100)).toFixed(2));
      return { ...l, line_no: idx + 1, vatRate, subtotal, vat, total: subtotal + vat };
    });

    const totSubtotal = mappedLines.reduce((s, l) => s + l.subtotal, 0);
    const totVat = mappedLines.reduce((s, l) => s + l.vat, 0);
    const totTotal = mappedLines.reduce((s, l) => s + l.total, 0);

    const headerRows = await client.query(
      `INSERT INTO ar_credit_memos (company_id, branch_id, cm_no, customer_id, original_invoice_id, cm_date, reason, notes, subtotal, vat_amount, total, amount_applied, unapplied_amount, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$11,'draft',$12) RETURNING *`,
      [
        companyId, dto.branch_id ?? null, cmNo, customerId, dto.original_invoice_id ?? null,
        dto.cm_date, dto.reason ?? null, dto.notes ?? null,
        totSubtotal.toFixed(2), totVat.toFixed(2), totTotal.toFixed(2), auth.userId,
      ],
    );
    const header = headerRows.rows[0];

    for (const l of mappedLines) {
      await client.query(
        `INSERT INTO ar_credit_memo_lines (cm_id, line_no, item_id, description, quantity, unit_price, vat_rate, line_subtotal, line_vat, line_total, revenue_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          header.id, l.line_no, l.item_id ?? null, l.description,
          l.quantity, l.unit_price, l.vatRate,
          l.subtotal.toFixed(2), l.vat.toFixed(2), l.total.toFixed(2),
          l.revenue_account_id ?? null,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'ar_credit_memo', header.id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');

    // Fetch full record
    const fullHeaders = await query(
      `SELECT cm.*, c.name AS customer_name, si.invoice_no FROM ar_credit_memos cm JOIN customers c ON c.id = cm.customer_id LEFT JOIN sales_invoices si ON si.id = cm.original_invoice_id WHERE cm.id = $1 LIMIT 1`,
      [header.id],
    );
    const cmLines = await query(
      `SELECT cml.*, i.sku AS item_sku, i.name AS item_name FROM ar_credit_memo_lines cml LEFT JOIN items i ON i.id = cml.item_id WHERE cml.cm_id = $1 ORDER BY cml.line_no`,
      [header.id],
    );

    return ok({ ...mapRow(fullHeaders[0] as Record<string, unknown>), lines: cmLines }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
