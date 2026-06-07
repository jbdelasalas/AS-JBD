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

  const warehouseId  = searchParams.get('warehouse_id');
  const search       = searchParams.get('search') ?? '';
  const lowStockOnly = searchParams.get('low_stock') === 'true';
  const hideZero     = searchParams.get('hide_zero') === 'true';

  const params: unknown[] = [companyId];

  // Base WHERE on items / warehouses (not on LEFT-JOINed columns)
  let baseWhere = `i.company_id = $1 AND i.is_active = true AND w.company_id = $1`;
  if (warehouseId) {
    params.push(warehouseId);
    baseWhere += ` AND w.id = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    baseWhere += ` AND (i.sku ILIKE $${params.length} OR i.name ILIKE $${params.length})`;
  }

  // Normalise poultry_inventory_balance: only include rows that have a warehouse_id.
  // NULL-warehouse rows are excluded so they don't inflate a random warehouse's balance.
  const rows = await query(
    `WITH pib_norm AS (
       SELECT
         p.item_id,
         p.warehouse_id,
         SUM(p.qty_kgs)    AS qty_kgs,
         MAX(p.avg_cost)   AS avg_cost,
         MAX(p.last_updated) AS last_updated
       FROM poultry_inventory_balance p
       WHERE p.company_id = $1 AND p.warehouse_id IS NOT NULL
       GROUP BY p.item_id, p.warehouse_id
     ),
     combined AS (
       SELECT
         i.id            AS item_id,
         i.sku,
         i.name,
         i.uom,
         i.reorder_point,
         w.id            AS warehouse_id,
         w.name          AS warehouse_name,
         COALESCE(sb.qty_on_hand, 0) + COALESCE(pib.qty_kgs, 0)  AS qty_on_hand,
         CASE
           WHEN COALESCE(sb.qty_on_hand, 0) + COALESCE(pib.qty_kgs, 0) > 0
           THEN (  COALESCE(sb.qty_on_hand, 0) * COALESCE(sb.avg_cost,  i.standard_cost)
                 + COALESCE(pib.qty_kgs,    0) * COALESCE(pib.avg_cost, i.standard_cost)
                ) / (COALESCE(sb.qty_on_hand, 0) + COALESCE(pib.qty_kgs, 0))
           ELSE COALESCE(sb.avg_cost, pib.avg_cost, i.standard_cost)
         END AS avg_cost,
         GREATEST(sb.last_movement_at, pib.last_updated) AS last_movement_at
       FROM items i
       CROSS JOIN warehouses w
       LEFT JOIN stock_balances sb
         ON sb.item_id = i.id AND sb.warehouse_id = w.id
       LEFT JOIN pib_norm pib
         ON pib.item_id = i.id AND pib.warehouse_id = w.id
       WHERE ${baseWhere}
     )
     SELECT
       item_id, sku, name, uom, reorder_point,
       warehouse_id, warehouse_name,
       qty_on_hand,
       avg_cost,
       qty_on_hand * avg_cost AS stock_value,
       last_movement_at
     FROM combined
     WHERE TRUE
       ${hideZero   ? 'AND qty_on_hand > 0'                    : ''}
       ${lowStockOnly ? 'AND qty_on_hand <= reorder_point'     : ''}
     ORDER BY sku, warehouse_name`,
    params,
  );

  return ok(rows.map((r) => ({
    ...r,
    qty_on_hand:   Number(r.qty_on_hand),
    avg_cost:      Number(r.avg_cost),
    stock_value:   Number(r.stock_value),
    reorder_point: Number(r.reorder_point),
  })));
}
