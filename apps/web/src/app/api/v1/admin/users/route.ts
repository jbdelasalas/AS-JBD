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
    const search = searchParams.get('search') ?? '';

    const rows = await query<{
      id: string; email: string; full_name: string;
      is_active: boolean; is_superadmin: boolean; created_at: string;
      roles: string;
    }>(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.is_superadmin, u.created_at,
              STRING_AGG(r.name, ', ' ORDER BY r.name) AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
           AND ($1::uuid IS NULL OR ur.company_id = $1)
         LEFT JOIN roles r ON r.id = ur.role_id
        WHERE ($2 = '' OR u.email ILIKE '%' || $2 || '%'
                       OR u.full_name ILIKE '%' || $2 || '%')
        GROUP BY u.id
        ORDER BY u.full_name
        LIMIT 500`,
      [companyId, search]
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
    const { email, full_name, password, is_active = true } = body;

    if (!email || !full_name || !password) {
      return err('email, full_name and password are required', 400);
    }

    const bcrypt = await import('bcryptjs');
    const password_hash = await bcrypt.hash(password, 12);

    const [user] = await query<{ id: string; email: string }>(
      `INSERT INTO users (email, full_name, password_hash, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email`,
      [email, full_name, password_hash, is_active, auth.userId]
    );

    return ok(user, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
