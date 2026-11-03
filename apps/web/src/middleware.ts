import { NextRequest, NextResponse } from 'next/server';
import { verifyAccess } from '@/lib/auth-helpers';
import { confinedScopes, apiAllowed } from '@/lib/access-scopes';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Warehouse / dressing-plant staff reach only their module's API. A missing or
  // bad token falls through so the route answers 401 as usual.
  if (pathname.startsWith('/api/v1/')) {
    const auth = request.headers.get('authorization') ?? '';
    const payload = auth.startsWith('Bearer ') ? await verifyAccess(auth.slice(7)) : null;
    const scopes = payload ? confinedScopes(payload.permissions ?? [], payload.isSuperadmin) : null;
    if (scopes && !apiAllowed(scopes, pathname, request.method)) {
      return NextResponse.json({ error: 'Your role does not have access to this module' }, { status: 403 });
    }
  }

  const mode = request.cookies.get('db-mode')?.value === 'sandbox' ? 'sandbox' : 'production';
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-db-mode', mode);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    '/api/v1/((?!auth/).*)',
    '/dashboard/:path*',
    '/portal/:path*',
  ],
};
