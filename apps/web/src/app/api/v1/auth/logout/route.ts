export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import * as crypto from 'crypto';
import { getPool } from '@/lib/db';

function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  return getPool(false).query(sql, params).then((r) => r.rows as T[]);
}
import { requireAuth } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  let refreshToken: string | undefined;
  try {
    const body = await request.json();
    refreshToken = body.refresh_token;
  } catch {
    // body is optional
  }

  if (refreshToken) {
    const hash = hashToken(refreshToken);
    await query(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [hash, auth.userId],
    );
  }

  return ok({ success: true });
}
