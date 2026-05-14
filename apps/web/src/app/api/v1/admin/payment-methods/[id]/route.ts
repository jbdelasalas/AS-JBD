export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const body = await req.json();
    const allowed = ['name', 'account_id', 'requires_reference', 'is_active'];
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
      `UPDATE payment_methods SET ${fields.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING id`,
      values
    );
    if (!updated) return err('Not found', 404);

    return ok(updated);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
