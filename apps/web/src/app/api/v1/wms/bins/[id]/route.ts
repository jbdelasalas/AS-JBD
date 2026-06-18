export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of ['zone', 'bin_type', 'is_active'] as const) {
    if (f in dto) { vals.push(dto[f]); sets.push(`${f} = $${vals.length}`); }
  }
  if (!sets.length) return err('No fields to update', 400);
  vals.push(params.id);

  const [bin] = await query(`UPDATE bins SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  if (!bin) return err('Bin not found', 404);
  return ok(bin);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  // Block deletion if the bin still holds stock — deactivate instead.
  const held = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM bin_stock_balances WHERE bin_id = $1 AND qty_on_hand <> 0`,
    [params.id],
  );
  if (held[0].c > 0) return err('Bin still holds stock — empty it before deleting, or deactivate it instead', 409);

  await query(`DELETE FROM bins WHERE id = $1`, [params.id]);
  return ok({ deleted: true });
}
