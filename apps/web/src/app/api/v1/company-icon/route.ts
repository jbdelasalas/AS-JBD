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

    // Browsers draw favicons into a square slot and stretch non-square images,
    // distorting the logo. Wrap the stored logo in a square SVG with a white
    // background and let preserveAspectRatio center it ("contain"), so the logo
    // keeps its proportions on the browser tab and the installed app icon.
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
      `<rect width="512" height="512" fill="#ffffff"/>` +
      // Inset the logo into the maskable "safe zone" (~80% of the canvas) so the
      // OS can crop the corners of the installed icon without clipping the logo.
      `<image href="${logo}" x="51" y="51" width="410" height="410" preserveAspectRatio="xMidYMid meet"/>` +
      `</svg>`;

    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
