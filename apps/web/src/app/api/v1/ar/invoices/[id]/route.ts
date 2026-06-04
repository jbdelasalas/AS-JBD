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
              so.order_no, dr.dr_no
         FROM sales_invoices si
         JOIN customers c ON c.id = si.customer_id
         LEFT JOIN sales_orders so ON so.id = si.so_id
         LEFT JOIN delivery_receipts dr ON dr.id = si.dr_id
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
      `SELECT sil.*, i.sku AS item_sku, i.name AS item_name, i.uom AS item_uom
         FROM sales_invoice_lines sil
         LEFT JOIN items i ON i.id = sil.item_id
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
