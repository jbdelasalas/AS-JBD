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
      `SELECT * FROM farm_buildings WHERE company_id = $1 AND is_active = true ORDER BY code`, [companyId]);
    return ok(rows);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  if (!companyId || !dto.code || !dto.name) return err('company_id, code, and name are required', 400);
  try {
    const [row] = await query(
      `INSERT INTO farm_buildings (company_id, branch_id, code, name, capacity_heads, building_type, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`,
      [companyId, dto.branch_id ?? null, dto.code, dto.name, dto.capacity_heads ?? null, dto.building_type ?? 'broiler'],
    );
    await query(`INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state) VALUES ($1,$2,'create','farm_building',$3,$4)`,
      [auth.userId, companyId, (row as Record<string,unknown>).id, JSON.stringify(row)]).catch(() => {});
    return ok(row, 201);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
