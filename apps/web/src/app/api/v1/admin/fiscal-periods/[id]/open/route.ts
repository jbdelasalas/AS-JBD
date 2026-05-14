import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const pool = getPool();
    await pool.query(`SELECT open_fiscal_period($1, $2)`, [params.id, auth.userId]);

    return ok({ ok: true });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
