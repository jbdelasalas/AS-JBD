export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const warehouseId = searchParams.get('warehouse_id');
  const search = searchParams.get('search') ?? '';
  const lowStockOnly = searchParams.get('low_stock') === 'true';

  const params: unknown[] = [companyId];
  let where = `i.company_id = $1 AND i.is_active = true`;
  if (warehouseId) { params.push(warehouseId); where += ` AND sb.warehouse_id = $${params.length}`; }
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (i.sku ILIKE $${params.length} OR i.name ILIKE $${params.length})`;
  }
  if (lowStockOnly) where += ` AND sb.qty_on_hand <= i.reorder_point`;

  const rows = await query(
    `SELECT i.id AS item_id, i.sku, i.name, i.uom, i.reorder_point,
            w.id AS warehouse_id, w.name AS warehouse_name,
            COALESCE(sb.qty_on_hand, 0) AS qty_on_hand,
            COALESCE(sb.avg_cost, i.standard_cost) AS avg_cost,
            COALESCE(sb.qty_on_hand, 0) * COALESCE(sb.avg_cost, i.standard_cost) AS stock_value,
            sb.last_movement_at
       FROM items i
       CROSS JOIN warehouses w
       LEFT JOIN stock_balances sb ON sb.item_id = i.id AND sb.warehouse_id = w.id
      WHERE ${where}
        AND w.company_id = $1
      ORDER BY i.sku, w.name`,
    params,
  );

  return ok(rows.map((r) => ({
    ...r,
    qty_on_hand: Number(r.qty_on_hand),
    avg_cost: Number(r.avg_cost),
    stock_value: Number(r.stock_value),
    reorder_point: Number(r.reorder_point),
  })));
}
