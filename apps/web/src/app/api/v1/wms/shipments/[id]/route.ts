export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const [header] = await query(
    `SELECT s.*, w.name AS warehouse_name, so.order_no, pl.pick_no
       FROM shipments s
       JOIN warehouses w ON w.id = s.warehouse_id
       LEFT JOIN sales_orders so ON so.id = s.so_id
       LEFT JOIN pick_lists pl ON pl.id = s.pick_id
      WHERE s.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!header) return err('Shipment not found', 404);

  const lines = await query(
    `SELECT sl.*, i.sku, i.name AS item_name, i.uom, b.code AS bin_code, l.lot_no
       FROM shipment_lines sl
       JOIN items i ON i.id = sl.item_id
       JOIN bins b ON b.id = sl.bin_id
       LEFT JOIN item_lots l ON l.id = sl.lot_id
      WHERE sl.shipment_id = $1 ORDER BY sl.line_no`,
    [params.id],
  );
  return ok({ ...header, lines });
}
