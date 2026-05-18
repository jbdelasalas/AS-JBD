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

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId || !dto.sku || !dto.name) return err('company_id, sku, and name are required', 400);

  const dup = await query(`SELECT id FROM items WHERE company_id = $1 AND sku = $2 LIMIT 1`, [companyId, dto.sku]);
  if (dup.length) return err(`SKU ${dto.sku} already exists`, 409);

  const rows = await query(
    `INSERT INTO items
       (company_id, sku, name, uom, item_type, costing_method,
        standard_cost, selling_price, reorder_point, category_id, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, sku, name, uom, item_type, costing_method, standard_cost, selling_price, reorder_point, is_active`,
    [
      companyId, dto.sku, dto.name,
      dto.uom ?? 'PCS',
      dto.item_type ?? 'stock',
      dto.costing_method ?? 'weighted_avg',
      dto.standard_cost ?? 0,
      dto.selling_price ?? 0,
      dto.reorder_point ?? 0,
      dto.category_id ?? null,
      dto.is_active ?? true,
    ],
  );
  const item = rows[0] as Record<string, unknown>;

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [auth.userId, companyId, 'create', 'item', item.id, JSON.stringify(item)],
  ).catch(() => {});

  return ok({
    ...item,
    standard_cost: Number(item.standard_cost),
    selling_price: Number(item.selling_price),
    reorder_point: Number(item.reorder_point),
  }, 201);
}
