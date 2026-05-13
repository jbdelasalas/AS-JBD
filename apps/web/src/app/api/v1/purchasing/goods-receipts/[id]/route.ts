export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

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
    `SELECT gr.*, po.po_no, s.name AS supplier_name, s.code AS supplier_code
       FROM goods_receipts gr
       JOIN purchase_orders po ON po.id = gr.po_id
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE gr.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Goods receipt ${params.id} not found`, 404);

  const lines = await query(
    `SELECT grl.*, pol.description, pol.quantity AS po_qty, pol.unit_price,
            i.sku AS item_sku, i.name AS item_name
       FROM goods_receipt_lines grl
       JOIN purchase_order_lines pol ON pol.id = grl.po_line_id
       LEFT JOIN items i ON i.id = pol.item_id
      WHERE grl.grn_id = $1
      ORDER BY grl.line_no`,
    [params.id],
  );

  return ok({
    ...rows[0],
    lines: lines.map((l) => {
      const row = l as Record<string, unknown>;
      return {
        ...row,
        qty_received: Number(row.qty_received),
        unit_cost: Number(row.unit_cost),
        po_qty: Number(row.po_qty),
        unit_price: Number(row.unit_price),
      };
    }),
  });
}
