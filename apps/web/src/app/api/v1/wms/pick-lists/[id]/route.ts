export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const [header] = await query(
    `SELECT p.*, w.name AS warehouse_name, so.order_no
       FROM pick_lists p
       JOIN warehouses w ON w.id = p.warehouse_id
       LEFT JOIN sales_orders so ON so.id = p.so_id
      WHERE p.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!header) return err('Pick list not found', 404);

  const lines = await query(
    `SELECT pl.*, i.sku, i.name AS item_name, i.uom, b.code AS bin_code, l.lot_no,
            COALESCE(bsb.qty_on_hand, 0) AS bin_available
       FROM pick_list_lines pl
       JOIN items i ON i.id = pl.item_id
       JOIN bins b ON b.id = pl.bin_id
       LEFT JOIN item_lots l ON l.id = pl.lot_id
       LEFT JOIN bin_stock_balances bsb
         ON bsb.item_id = pl.item_id AND bsb.bin_id = pl.bin_id
         AND COALESCE(bsb.lot_id,'00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(pl.lot_id,'00000000-0000-0000-0000-000000000000'::uuid)
      WHERE pl.pick_id = $1 ORDER BY pl.line_no`,
    [params.id],
  );
  return ok({ ...header, lines });
}
