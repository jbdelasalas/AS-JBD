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
