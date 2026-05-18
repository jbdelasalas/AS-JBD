export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('company_id');

    const rows = await query<{
      id: string; code: string; name: string; description: string | null;
      permission_count: number;
    }>(
      `SELECT r.id, r.code, r.name, r.description,
              COUNT(rp.permission_id)::int AS permission_count
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        GROUP BY r.id
        ORDER BY r.name`,
      []
    );

    return ok(rows);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const body = await req.json();
    const { code, name, description } = body;
    if (!code || !name) return err('code and name are required', 400);

    const [role] = await query<{ id: string; code: string; name: string }>(
      `INSERT INTO roles (code, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, code, name`,
      [code, name, description ?? null]
    );

    return ok(role, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
