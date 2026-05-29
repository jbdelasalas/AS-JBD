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
  try {
    const rows = await query(
      `SELECT b.id, b.qty_heads, b.qty_kgs, b.avg_cost, b.last_updated,
              i.sku, i.name AS item_name, i.uom,
              w.name AS warehouse_name, w.code AS warehouse_code
         FROM poultry_inventory_balance b
         JOIN items i ON i.id = b.item_id
         LEFT JOIN warehouses w ON w.id = b.warehouse_id
        WHERE b.company_id = $1
        ORDER BY i.sku, w.code`,
      [companyId],
    );
    return ok(rows.map(r => ({
      ...r,
      qty_heads: Number((r as Record<string,unknown>).qty_heads),
      qty_kgs: Number((r as Record<string,unknown>).qty_kgs),
      avg_cost: Number((r as Record<string,unknown>).avg_cost),
    })));
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
