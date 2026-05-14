export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(
    `SELECT st.*, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name,
            u.full_name AS created_by_name
       FROM stock_transfers st
       JOIN warehouses fw ON fw.id = st.from_warehouse_id
       JOIN warehouses tw ON tw.id = st.to_warehouse_id
       JOIN users u ON u.id = st.created_by
      WHERE st.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err('Not found', 404);

  const lines = await query(
    `SELECT stl.*, i.sku, i.name AS item_name, i.uom
       FROM stock_transfer_lines stl
       JOIN items i ON i.id = stl.item_id
      WHERE stl.transfer_id = $1 ORDER BY stl.line_no`,
    [params.id],
  );

  return ok({ ...rows[0], lines: lines.map((l) => ({ ...l, qty: Number(l.qty) })) });
}
