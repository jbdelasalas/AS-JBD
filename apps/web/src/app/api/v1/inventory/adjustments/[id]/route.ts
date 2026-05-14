export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(
    `SELECT sa.*, w.name AS warehouse_name, u.full_name AS created_by_name
       FROM stock_adjustments sa
       JOIN warehouses w ON w.id = sa.warehouse_id
       JOIN users u ON u.id = sa.created_by
      WHERE sa.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err('Not found', 404);

  const lines = await query(
    `SELECT sal.*, i.sku, i.name AS item_name, i.uom
       FROM stock_adjustment_lines sal
       JOIN items i ON i.id = sal.item_id
      WHERE sal.adj_id = $1 ORDER BY sal.line_no`,
    [params.id],
  );

  return ok({
    ...rows[0],
    lines: lines.map((l) => ({
      ...l,
      qty_change: Number(l.qty_change),
      unit_cost: Number(l.unit_cost),
      line_total: Number(l.line_total),
    })),
  });
}
