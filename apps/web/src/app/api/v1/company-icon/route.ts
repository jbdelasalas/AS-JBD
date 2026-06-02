export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const rows = await query<{ logo: string | null }>(
      `SELECT logo FROM companies WHERE is_active = true AND logo IS NOT NULL ORDER BY created_at LIMIT 1`,
    );

    const logo = rows[0]?.logo;
    if (!logo || !logo.startsWith('data:')) {
      return new NextResponse(null, { status: 404 });
    }

    const [header, data] = logo.split(',');
    const contentType = header.match(/data:(.*?);/)?.[1] ?? 'image/jpeg';
    const buffer = Buffer.from(data, 'base64');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
