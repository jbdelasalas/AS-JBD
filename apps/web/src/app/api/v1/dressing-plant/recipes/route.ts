export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Marination recipes + their BOM lines (ingredient qty per kg finished pack).

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT r.id, r.code, r.name, r.is_active,
            COALESCE(json_agg(json_build_object(
              'item_id', b.item_id, 'item_name', i.name, 'qty_per_kg', b.qty_per_kg
            ) ORDER BY i.name) FILTER (WHERE b.id IS NOT NULL), '[]') AS bom
       FROM dp_recipes r
       LEFT JOIN dp_bom_items b ON b.recipe_id = r.id
       LEFT JOIN items i ON i.id = b.item_id
      WHERE r.company_id = $1
      GROUP BY r.id
      ORDER BY r.name`,
    [companyId],
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.code) return err('code is required', 400);
  if (!dto.name) return err('name is required', 400);
  const bom = Array.isArray(dto.bom) ? (dto.bom as Array<Record<string, unknown>>) : [];

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const recipeRows = await client.query<{ id: string }>(
      `INSERT INTO dp_recipes (company_id, code, name)
       VALUES ($1,$2,$3) RETURNING id`,
      [companyId, String(dto.code).toUpperCase(), dto.name],
    );
    const recipeId = recipeRows.rows[0].id;
    for (const line of bom) {
      if (!line.item_id || !(Number(line.qty_per_kg) > 0)) continue;
      await client.query(
        `INSERT INTO dp_bom_items (recipe_id, item_id, qty_per_kg) VALUES ($1,$2,$3)
         ON CONFLICT (recipe_id, item_id) DO UPDATE SET qty_per_kg = EXCLUDED.qty_per_kg`,
        [recipeId, line.item_id, Number(line.qty_per_kg)],
      );
    }
    await client.query('COMMIT');
    return ok({ id: recipeId }, 201);
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = (e as Error).message ?? 'Failed to create recipe';
    if (/unique|duplicate/i.test(msg)) return err(`Recipe ${dto.code} already exists`, 409);
    return err(msg, 500);
  } finally {
    client.release();
  }
}
