import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);

    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('company_id');

    const rows = await query<{
      id: string; company_id: string | null; name: string;
      description: string | null; is_system: boolean; is_active: boolean; created_at: string;
      permission_count: number;
    }>(
      `SELECT r.id, r.company_id, r.name, r.description, r.is_system, r.is_active, r.created_at,
              COUNT(rp.permission_id)::int AS permission_count
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE (r.company_id = $1 OR r.company_id IS NULL)
        GROUP BY r.id
        ORDER BY r.is_system DESC, r.name`,
      [companyId]
    );

    return ok(rows);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const body = await req.json();
    const { company_id, name, description } = body;
    if (!name) return err('name is required', 400);

    const [role] = await query<{ id: string; name: string }>(
      `INSERT INTO roles (company_id, name, description, is_system)
       VALUES ($1, $2, $3, false)
       RETURNING id, name`,
      [company_id ?? null, name, description ?? null]
    );

    return ok(role, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
