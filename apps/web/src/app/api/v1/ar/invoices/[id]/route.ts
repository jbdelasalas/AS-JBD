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
  let lines: Record<string, unknown>[];
  try {
    headers = await query(
      `SELECT si.*, c.name AS customer_name, c.code AS customer_code,
              c.address AS customer_address, c.payment_terms_days AS customer_terms,
              so.order_no, dr.dr_no,
              br.code AS branch_code, br.name AS branch_name,
              fb.code AS building_code, fb.name AS building_name,
              cc.code AS cost_center_code, cc.name AS cost_center_name,
              gr.code AS grow_ref_code, gr.name AS grow_ref_name
         FROM sales_invoices si
         JOIN customers c ON c.id = si.customer_id
         LEFT JOIN sales_orders so ON so.id = si.so_id
         LEFT JOIN delivery_receipts dr ON dr.id = si.dr_id
         LEFT JOIN branches br ON br.id = si.branch_id
         LEFT JOIN farm_buildings fb ON fb.id = si.building_id
         LEFT JOIN cost_centers cc ON cc.id = si.cost_center_id
         LEFT JOIN grow_references gr ON gr.id = si.grow_reference_id
        WHERE si.id = $1 LIMIT 1`,
      [params.id],
    ) as Record<string, unknown>[];
  } catch {
    // dr_id column may not exist yet — retry without the DR join
    headers = await query(
      `SELECT si.*, c.name AS customer_name, c.code AS customer_code,
              c.address AS customer_address, c.payment_terms_days AS customer_terms,
              so.order_no
         FROM sales_invoices si
         JOIN customers c ON c.id = si.customer_id
         LEFT JOIN sales_orders so ON so.id = si.so_id
        WHERE si.id = $1 LIMIT 1`,
      [params.id],
    ) as Record<string, unknown>[];
  }
  if (!headers[0]) return err(`Invoice ${params.id} not found`, 404);

  try {
    lines = await query(
      `SELECT sil.*, i.sku AS item_sku, i.name AS item_name, i.uom AS item_uom,
              br.code AS branch_code, fb.code AS building_code,
              cc.code AS cost_center_code, gr.code AS grow_ref_code
         FROM sales_invoice_lines sil
         LEFT JOIN items i ON i.id = sil.item_id
         LEFT JOIN branches br ON br.id = sil.branch_id
         LEFT JOIN farm_buildings fb ON fb.id = sil.building_id
         LEFT JOIN cost_centers cc ON cc.id = sil.cost_center_id
         LEFT JOIN grow_references gr ON gr.id = sil.grow_reference_id
        WHERE sil.invoice_id = $1
        ORDER BY sil.line_no`,
      [params.id],
    ) as Record<string, unknown>[];
  } catch (e) {
    return err((e as Error).message ?? 'Failed to load invoice lines', 500);
  }

  return ok({
    ...mapRow(headers[0] as Record<string, unknown>),
    lines: lines.map((l) => mapLine(l as Record<string, unknown>)),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const dtoLines = dto.lines as Array<Record<string, unknown>>;
  if (!dtoLines?.length) return err('Invoice must have at least one line', 400);

  const existing = await query<{ status: string; company_id: string }>(
    `SELECT status, company_id FROM sales_invoices WHERE id = $1 LIMIT 1`, [params.id]);
  if (!existing[0]) return err('Invoice not found', 404);
  if (existing[0].status !== 'draft') return err('Only draft invoices can be edited', 409);

  const companyId = existing[0].company_id;
  const customerId = dto.customer_id as string;
  const customers = await query<{ payment_terms_days: number }>(
    `SELECT payment_terms_days FROM customers WHERE id = $1 AND company_id = $2`, [customerId, companyId]);
  if (!customers[0]) return err('Customer not found', 404);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const terms = (dto.payment_terms_days as number) ?? customers[0].payment_terms_days ?? 30;
    const mappedLines = dtoLines.map((l, idx) => {
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

    await client.query(
      `UPDATE sales_invoices SET
         customer_id=$1, invoice_date=$2, due_date=$3, payment_terms_days=$4,
         reference=$5, notes=$6, branch_id=$7, building_id=$8, cost_center_id=$9,
         grow_reference_id=$10, subtotal=$11, vat_amount=$12, total=$13,
         balance=$13, updated_at=now()
       WHERE id=$14`,
      [
        customerId, dto.invoice_date, dueDate.toISOString().split('T')[0], terms,
        dto.reference ?? null, dto.notes ?? null,
        dto.branch_id ?? null, dto.building_id ?? null,
        dto.cost_center_id ?? null, dto.grow_reference_id ?? null,
        totSubtotal.toFixed(2), totVat.toFixed(2), totTotal.toFixed(2),
        params.id,
      ],
    );

    await client.query(`DELETE FROM sales_invoice_lines WHERE invoice_id = $1`, [params.id]);
    for (const l of mappedLines) {
      await client.query(
        `INSERT INTO sales_invoice_lines
           (invoice_id, line_no, item_id, description, quantity, unit_price,
            discount_pct, vat_rate, line_subtotal, line_vat, line_total,
            branch_id, building_id, cost_center_id, grow_reference_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          params.id, l.line_no, l.item_id ?? null, l.description,
          l.quantity, l.unit_price, l.disc, l.vatRate,
          l.subtotal.toFixed(2), l.vat.toFixed(2), l.total.toFixed(2),
          (l as Record<string, unknown>).branch_id ?? null,
          (l as Record<string, unknown>).building_id ?? null,
          (l as Record<string, unknown>).cost_center_id ?? null,
          (l as Record<string, unknown>).grow_reference_id ?? null,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Update failed', 500);
  } finally { client.release(); }

  const updated = await query(
    `SELECT si.*, c.name AS customer_name, c.code AS customer_code, so.order_no
       FROM sales_invoices si JOIN customers c ON c.id = si.customer_id
       LEFT JOIN sales_orders so ON so.id = si.so_id
      WHERE si.id = $1 LIMIT 1`, [params.id]);
  const updatedLines = await query(
    `SELECT sil.*, i.sku AS item_sku, i.name AS item_name, i.uom AS item_uom
       FROM sales_invoice_lines sil LEFT JOIN items i ON i.id = sil.item_id
      WHERE sil.invoice_id = $1 ORDER BY sil.line_no`, [params.id]);

  return ok({
    ...mapRow(updated[0] as Record<string, unknown>),
    lines: updatedLines.map((l) => mapLine(l as Record<string, unknown>)),
  });
}
