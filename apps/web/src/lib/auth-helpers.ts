import { SignJWT, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';

function accessSecret(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_ACCESS_SECRET ?? 'changeme-access');
}

function expiresIn(): string {
  return process.env.JWT_ACCESS_EXPIRES ?? '25m';
}

export interface JwtPayload {
  sub: string;
  email: string;
  isSuperadmin: boolean;
  permissions: string[];
}

export async function signAccess(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn())
    .sign(accessSecret());
}

export async function verifyAccess(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret());
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

export interface AuthContext {
  userId: string;
  email: string;
  isSuperadmin: boolean;
  permissions: string[];
}

export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = await verifyAccess(token);
  if (!payload || !payload.sub) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return {
    userId: payload.sub,
    email: payload.email,
    isSuperadmin: payload.isSuperadmin,
    permissions: payload.permissions ?? [],
  };
}

/**
 * The one permission the `label_printer` role holds. Kept here so the API
 * routes, the sidebar and the login redirect all name the same string.
 */
export const LABEL_PRINT_PERMISSION = 'dressing_plant.label.print';

export function hasPermission(auth: AuthContext, permission: string): boolean {
  return auth.isSuperadmin || auth.permissions.includes(permission);
}

/**
 * Like `requireAuth`, but also demands a permission. Throws a 403 `Response`
 * the route returns as-is, matching the `catch (e) { return e as Response }`
 * shape the existing routes already use.
 *
 * A user holding *any* permission beyond the label one still passes when they
 * have it; this gates the endpoint, it does not confine the caller.
 */
export async function requirePermission(
  request: NextRequest,
  permission: string,
): Promise<AuthContext> {
  const auth = await requireAuth(request);
  if (!hasPermission(auth, permission)) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return auth;
}
