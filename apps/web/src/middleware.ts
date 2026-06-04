import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const mode = request.cookies.get('db-mode')?.value === 'sandbox' ? 'sandbox' : 'production';
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-db-mode', mode);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/api/v1/:path*', '/dashboard/:path*'],
};
