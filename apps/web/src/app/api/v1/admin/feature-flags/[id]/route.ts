export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The rollout columns are `uuid[]`; anything that isn't a clean list of uuids
// would either error deep in the driver or silently store junk, so reject it
// here with a message the admin UI can show.
function parseUuidArray(value: unknown, col: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${col} must be an array of ids`);
  const ids = value.map((v) => String(v).trim()).filter(Boolean);
  for (const id of ids) {
    if (!UUID_RE.test(id)) throw new Error(`${col} contains an invalid id: ${id}`);
  }
  return [...new Set(ids)];
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const body = await req.json();
    const allowed = ['enabled', 'description', 'rollout_companies', 'rollout_users'];
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const col of allowed) {
      if (!(col in body)) continue;
      let value = body[col];
      if (col === 'rollout_companies' || col === 'rollout_users') {
        try {
          value = parseUuidArray(value, col);
        } catch (e) {
          return err((e as Error).message, 400);
        }
      }
      fields.push(`${col} = $${idx++}`);
      values.push(value);
    }
    if (fields.length === 0) return err('No fields to update', 400);

    values.push(params.id);
    const [updated] = await query<{ id: string }>(
      `UPDATE feature_flags SET ${fields.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING id`,
      values
    );
    if (!updated) return err('Not found', 404);

    return ok(updated);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    await query(`DELETE FROM feature_flags WHERE id = $1`, [params.id]);
    return ok({ ok: true });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
