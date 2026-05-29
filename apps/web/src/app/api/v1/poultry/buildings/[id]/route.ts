export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  try {
    const [row] = await query(
      `UPDATE farm_buildings SET code=COALESCE($2,code), name=COALESCE($3,name),
         building_type=COALESCE($4,building_type), capacity_heads=$5,
         is_active=COALESCE($6,is_active) WHERE id=$1 RETURNING *`,
      [params.id, dto.code ?? null, dto.name ?? null, dto.building_type ?? null,
       dto.capacity_heads ?? null, dto.is_active ?? null],
    );
    if (!row) return err('Not found', 404);
    return ok(row);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
