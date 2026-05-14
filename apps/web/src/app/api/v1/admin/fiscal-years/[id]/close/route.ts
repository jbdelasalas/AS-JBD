export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const { re_account_id } = await req.json();
    if (!re_account_id) return err('re_account_id (Retained Earnings account) is required', 400);

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT year_end_close($1, $2, $3) AS je_id`,
      [params.id, auth.userId, re_account_id]
    );

    return ok({ je_id: rows[0].je_id });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
