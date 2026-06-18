export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const [header] = await query(
    `SELECT p.*, w.name AS warehouse_name, gr.grn_no
       FROM putaways p
       JOIN warehouses w ON w.id = p.warehouse_id
       LEFT JOIN goods_receipts gr ON gr.id = p.grn_id
      WHERE p.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!header) return err('Put-away not found', 404);

  const lines = await query(
    `SELECT pl.*, i.sku, i.name AS item_name, i.uom, b.code AS bin_code, l.lot_no
       FROM putaway_lines pl
       JOIN items i ON i.id = pl.item_id
       JOIN bins b ON b.id = pl.bin_id
       LEFT JOIN item_lots l ON l.id = pl.lot_id
      WHERE pl.putaway_id = $1 ORDER BY pl.line_no`,
    [params.id],
  );
  return ok({ ...header, lines });
}
