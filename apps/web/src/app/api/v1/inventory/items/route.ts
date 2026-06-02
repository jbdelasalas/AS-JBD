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
  const minimal = searchParams.get('minimal') === 'true';

  const params: unknown[] = [companyId];
  let where = `i.company_id = $1`;
  if (activeOnly) where += ` AND i.is_active = true`;
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (i.sku ILIKE $${params.length} OR i.name ILIKE $${params.length})`;
  }
  params.push(limit);

  try {
    if (minimal) {
      const rows = await query(
        `SELECT id, sku, name, uom, selling_price FROM items i WHERE ${where} ORDER BY sku LIMIT $${params.length}`,
        params,
      );
      return ok(rows.map((r) => ({ ...r, selling_price: Number(r.selling_price) })));
    }

    const rows = await query(
      `SELECT i.id, i.sku, i.name, i.uom, i.item_type, i.costing_method,
              i.standard_cost, i.selling_price, i.reorder_point, i.is_active,
              i.category_id,
              ic.name AS category_name,
              i.inventory_account_id, a1.code||' - '||a1.name AS inventory_account_name,
              i.cogs_account_id,      a2.code||' - '||a2.name AS cogs_account_name,
              i.revenue_account_id,   a3.code||' - '||a3.name AS revenue_account_name,
              i.purchase_variance_account_id, a4.code||' - '||a4.name AS purchase_variance_account_name,
              i.default_warehouse_id, w.name AS default_warehouse_name
         FROM items i
         LEFT JOIN item_categories ic ON ic.id = i.category_id
         LEFT JOIN accounts a1 ON a1.id = i.inventory_account_id
         LEFT JOIN accounts a2 ON a2.id = i.cogs_account_id
         LEFT JOIN accounts a3 ON a3.id = i.revenue_account_id
         LEFT JOIN accounts a4 ON a4.id = i.purchase_variance_account_id
         LEFT JOIN warehouses w ON w.id = i.default_warehouse_id
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
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
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
        standard_cost, selling_price, reorder_point, category_id, is_active,
        inventory_account_id, cogs_account_id, revenue_account_id, purchase_variance_account_id,
        default_warehouse_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id, sku, name, uom, item_type, costing_method, standard_cost, selling_price, reorder_point, is_active,
               inventory_account_id, cogs_account_id, revenue_account_id, purchase_variance_account_id,
               default_warehouse_id`,
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
      dto.inventory_account_id ?? null,
      dto.cogs_account_id ?? null,
      dto.revenue_account_id ?? null,
      dto.purchase_variance_account_id ?? null,
      dto.default_warehouse_id ?? null,
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
