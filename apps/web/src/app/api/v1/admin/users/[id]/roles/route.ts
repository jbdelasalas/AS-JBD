export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
    try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const { role_id, company_id } = await req.json();
    if (!role_id) return err('role_id is required', 400);

    await query(
      `INSERT INTO user_roles (user_id, role_id, company_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [params.id, role_id, company_id ?? null],
    );

    return ok({ ok: true });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
    try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const { role_id, company_id } = await req.json();
    if (!role_id) return err('role_id is required', 400);

    await query(
      `DELETE FROM user_roles
        WHERE user_id = $1 AND role_id = $2
          AND ($3::uuid IS NULL OR company_id = $3)`,
      [params.id, role_id, company_id ?? null],
    );

    return ok({ ok: true });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
