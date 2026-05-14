import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);

    const body = await req.json();
    const allowed = ['code', 'name', 'type', 'is_base'];
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const col of allowed) {
      if (col in body) {
        fields.push(`${col} = $${idx++}`);
        values.push(body[col]);
      }
    }
    if (fields.length === 0) return err('No fields to update', 400);

    values.push(params.id);
    const [updated] = await query<{ id: string }>(
      `UPDATE uoms SET ${fields.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING id`,
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
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);

    await query(`DELETE FROM uoms WHERE id = $1`, [params.id]);
    return ok({ ok: true });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
