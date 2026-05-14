import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const [user] = await query<{
      id: string; email: string; full_name: string;
      is_active: boolean; is_superadmin: boolean;
      twofa_enabled: boolean; created_at: string;
    }>(
      `SELECT id, email, full_name, is_active, is_superadmin, twofa_enabled, created_at
         FROM users WHERE id = $1`,
      [params.id]
    );
    if (!user) return err('Not found', 404);

    const roles = await query<{ company_id: string | null; role_id: string; role_name: string }>(
      `SELECT ur.company_id, ur.role_id, r.name AS role_name
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1`,
      [params.id]
    );

    return ok({ ...user, roles });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const body = await req.json();
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const col of ['full_name', 'is_active', 'is_superadmin'] as const) {
      if (col in body) {
        fields.push(`${col} = $${idx++}`);
        values.push(body[col]);
      }
    }

    if (body.password) {
      const bcrypt = await import('bcryptjs');
      fields.push(`password_hash = $${idx++}`);
      values.push(await bcrypt.hash(body.password, 12));
    }

    if (fields.length === 0) return err('No fields to update', 400);

    fields.push(`updated_by = $${idx++}`);
    values.push(auth.userId);
    values.push(params.id);

    const [updated] = await query<{ id: string }>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id`,
      values
    );
    if (!updated) return err('Not found', 404);

    return ok(updated);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
