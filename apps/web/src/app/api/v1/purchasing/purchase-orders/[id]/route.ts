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
  };
}

function mapLine(l: Record<string, unknown>) {
  return {
    ...l,
    quantity: Number(l.quantity),
    qty_received: Number(l.qty_received),
    unit_price: Number(l.unit_price),
    vat_rate: Number(l.vat_rate),
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

  const rows = await query(
    `SELECT po.*, s.name AS supplier_name, s.code AS supplier_code
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Purchase order ${params.id} not found`, 404);

  const lines = await query(
    `SELECT pol.*, i.sku AS item_sku, i.name AS item_name
       FROM purchase_order_lines pol
       LEFT JOIN items i ON i.id = pol.item_id
      WHERE pol.po_id = $1
      ORDER BY pol.line_no`,
    [params.id],
  );

  return ok({
    ...mapRow(rows[0] as Record<string, unknown>),
    lines: lines.map((l) => mapLine(l as Record<string, unknown>)),
  });
}
