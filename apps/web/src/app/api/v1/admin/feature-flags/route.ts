import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const rows = await query<{
      id: string; name: string; enabled: boolean;
      rollout_companies: string[]; rollout_users: string[];
      description: string | null; updated_at: string;
    }>(
      `SELECT id, name, enabled, rollout_companies, rollout_users, description, updated_at
         FROM feature_flags ORDER BY name`
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
    const { name, enabled = false, description } = body;
    if (!name) return err('name required', 400);

    const [flag] = await query<{ id: string; name: string }>(
      `INSERT INTO feature_flags (name, enabled, description)
       VALUES ($1, $2, $3)
       RETURNING id, name`,
      [name, enabled, description ?? null]
    );

    return ok(flag, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
