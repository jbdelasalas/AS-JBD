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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const headers = await query(
    `SELECT so.*, c.name AS customer_name, c.code AS customer_code, c.credit_limit,
            c.payment_terms_days AS customer_terms, c.address AS customer_address
       FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!headers[0]) return err(`Sales order ${params.id} not found`, 404);

  const lines = await query(
    `SELECT sol.*, i.sku AS item_sku, i.name AS item_name FROM sales_order_lines sol JOIN items i ON i.id = sol.item_id WHERE sol.order_id = $1 ORDER BY sol.line_no`,
    [params.id],
  );

  return ok({
    ...mapRow(headers[0] as Record<string, unknown>),
    lines: lines.map((l) => mapLine(l as Record<string, unknown>)),
  });
}
