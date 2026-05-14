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

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '500'), 500);
  const search = searchParams.get('search') ?? '';
  const activeOnly = searchParams.get('active_only') !== 'false';

  const params: unknown[] = [companyId];
  let where = `i.company_id = $1`;
  if (activeOnly) where += ` AND i.is_active = true`;
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (i.sku ILIKE $${params.length} OR i.name ILIKE $${params.length})`;
  }
  params.push(limit);

  const rows = await query(
    `SELECT i.id, i.sku, i.name, i.uom, i.item_type, i.costing_method,
            i.standard_cost, i.selling_price, i.reorder_point, i.is_active,
            ic.name AS category_name
       FROM items i
       LEFT JOIN item_categories ic ON ic.id = i.category_id
      WHERE ${where}
      ORDER BY i.sku
      LIMIT $${params.length}`,
    params,
  );

  return ok(rows.map((r) => ({
    ...r,
    standard_cost: Number(r.standard_cost),
    selling_price: Number(r.selling_price),
    reorder_point: Number(r.reorder_point),
  })));
}
