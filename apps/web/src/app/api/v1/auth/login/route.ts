export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { compare } from '@node-rs/bcrypt';
import * as crypto from 'crypto';
import { query } from '@/lib/db';
import { signAccess } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

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

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
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

async function getCompanies(userId: string, isSuperadmin: boolean) {
  return query<{ id: string; code: string; name: string }>(
    `SELECT DISTINCT c.id, c.code, c.name
       FROM companies c
       LEFT JOIN user_roles ur ON ur.company_id = c.id
      WHERE c.is_active
        AND ($1 OR ur.user_id = $2)
      ORDER BY c.name`,
    [isSuperadmin, userId],
  );
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
  let email: string, password: string;
  try {
    const body = await request.json();
    email = body.email;
    password = body.password;
  } catch {
    return err('Invalid request body', 400);
  }

  if (!email || !password) return err('email and password are required', 400);

  try {
    const rows = await query<{
      id: string;
      email: string;
      password_hash: string;
      full_name: string;
      is_active: boolean;
      is_superadmin: boolean;
      twofa_enabled: boolean;
    }>(
      `SELECT id, email, password_hash, full_name, is_active, is_superadmin, twofa_enabled
         FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [email],
    );
    const user = rows[0];

    if (!user || !user.is_active) return err('Invalid credentials', 401);

    const passwordOk = await compare(password, user.password_hash);
    if (!passwordOk) return err('Invalid credentials', 401);

    const [permissions, companies] = await Promise.all([
      getPermissions(user.id),
      getCompanies(user.id, user.is_superadmin),
    ]);

    const [accessToken, refreshToken] = await Promise.all([
      signAccess({ sub: user.id, email: user.email, isSuperadmin: user.is_superadmin, permissions }),
      issueRefreshToken(user.id),
    ]);

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null;
    const userAgent = request.headers.get('user-agent') ?? null;
    Promise.all([
      query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]),
      query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, 'login', 'user', user.id, ip, userAgent],
      ),
    ]).catch(() => {/* non-fatal */});

    return ok({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: parseExpiryToSeconds(process.env.JWT_ACCESS_EXPIRES ?? '15m'),
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        is_active: user.is_active,
        is_superadmin: user.is_superadmin,
        twofa_enabled: user.twofa_enabled,
      },
      permissions,
      companies,
    });
  } catch (e) {
    console.error('Login error:', e);
    return err('Service unavailable — database connection failed', 503);
  }
}
