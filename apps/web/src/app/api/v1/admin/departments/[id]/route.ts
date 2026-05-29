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
      `UPDATE departments SET code=COALESCE($2,code), name=COALESCE($3,name), description=$4,
         is_active=COALESCE($5,is_active) WHERE id=$1 RETURNING *`,
      [params.id, dto.code ?? null, dto.name ?? null, dto.description ?? null, dto.is_active ?? null],
    );
    if (!row) return err('Not found', 404);
    return ok(row);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
