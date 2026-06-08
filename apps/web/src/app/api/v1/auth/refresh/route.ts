export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import * as crypto from 'crypto';
import { getPool } from '@/lib/db';

function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  return getPool(false).query(sql, params).then((r) => r.rows as T[]);
}
import { signAccess } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function parseExpiryToSeconds(expr: string): number {
  const m = /^(\d+)([smhd])$/.exec(expr);
  if (!m) return 900;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  return unit === 's' ? n : unit === 'm' ? n * 60 : unit === 'h' ? n * 3600 : n * 86400;
}

function parseDaysFromExpires(expr: string): number {
  const m = /^(\d+)d$/.exec(expr);
  return m ? parseInt(m[1], 10) : 7;
}

async function getPermissions(userId: string): Promise<string[]> {
  const rows = await query<{ code: string }>(
    `SELECT DISTINCT p.code
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.code);
}

async function issueRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = hashToken(raw);
  const expires = new Date();
  const days = parseDaysFromExpires(process.env.JWT_REFRESH_EXPIRES ?? '7d');
  expires.setDate(expires.getDate() + days);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expires],
  );
  return raw;
}

export async function POST(request: NextRequest) {
  let refreshToken: string;
  try {
    const body = await request.json();
    refreshToken = body.refresh_token;
  } catch {
    return err('Invalid request body', 400);
  }

  if (!refreshToken) return err('refresh_token is required', 400);

  const tokenHash = hashToken(refreshToken);
  const rows = await query<{
    id: string;
    user_id: string;
    expires_at: string;
    revoked_at: string | null;
    is_active: boolean;
    is_superadmin: boolean;
    email: string;
  }>(
    `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.is_active, u.is_superadmin, u.email
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1
      LIMIT 1`,
    [tokenHash],
  );
  const row = rows[0];

  if (!row) return err('Invalid refresh token', 401);
  if (row.revoked_at) return err('Refresh token revoked', 401);
  if (new Date(row.expires_at) < new Date()) return err('Refresh token expired', 401);
  if (!row.is_active) return err('User inactive', 401);

  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);

  const permissions = await getPermissions(row.user_id);
  const newAccess = await signAccess({
    sub: row.user_id,
    email: row.email,
    isSuperadmin: row.is_superadmin,
    permissions,
  });
  const newRefresh = await issueRefreshToken(row.user_id);

  return ok({
    access_token: newAccess,
    refresh_token: newRefresh,
    expires_in: parseExpiryToSeconds(process.env.JWT_ACCESS_EXPIRES ?? '25m'),
  });
}
