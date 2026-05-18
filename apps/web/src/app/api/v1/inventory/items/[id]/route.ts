export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Ctx) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(
    `SELECT i.id, i.company_id, i.sku, i.name, i.uom, i.item_type, i.costing_method,
            i.standard_cost, i.selling_price, i.reorder_point, i.is_active,
            i.category_id, ic.name AS category_name
       FROM items i
       LEFT JOIN item_categories ic ON ic.id = i.category_id
      WHERE i.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Item ${params.id} not found`, 404);
  const r = rows[0] as Record<string, unknown>;
  return ok({
    ...r,
    standard_cost: Number(r.standard_cost),
    selling_price: Number(r.selling_price),
    reorder_point: Number(r.reorder_point),
  });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const existing = await query(`SELECT id, company_id FROM items WHERE id = $1 LIMIT 1`, [params.id]);
  if (!existing[0]) return err(`Item ${params.id} not found`, 404);
  const item = existing[0] as Record<string, unknown>;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return err('Invalid request body', 400); }

  const allowed = ['sku', 'name', 'uom', 'item_type', 'costing_method',
    'standard_cost', 'selling_price', 'reorder_point', 'category_id', 'is_active'];
  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const col of allowed) {
    if (col in body) {
      sets.push(`${col} = $${vals.length + 1}`);
      vals.push(body[col]);
    }
  }
  if (!sets.length) return err('No fields to update', 400);

  vals.push(params.id);
  const rows = await query(
    `UPDATE items SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING *`,
    vals,
  );
  const updated = rows[0] as Record<string, unknown>;

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [auth.userId, item.company_id, 'update', 'item', params.id, JSON.stringify(updated)],
  ).catch(() => {});

  return ok({
    ...updated,
    standard_cost: Number(updated.standard_cost),
    selling_price: Number(updated.selling_price),
    reorder_point: Number(updated.reorder_point),
  });
}
