export const dynamic = 'force-dynamic';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { mode } = await request.json().catch(() => ({ mode: 'production' }));
  const isSandbox = mode === 'sandbox';

  const response = NextResponse.json({ ok: true, mode: isSandbox ? 'sandbox' : 'production' });
  response.cookies.set('db-mode', isSandbox ? 'sandbox' : 'production', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return response;
}
