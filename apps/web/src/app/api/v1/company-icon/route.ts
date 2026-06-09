import { ImageResponse } from 'next/og';
import { query } from '@/lib/db';

// Run on Node (not edge) so the pg-based db layer works. next/og's
// ImageResponse renders a real PNG on the Node runtime as well.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const rows = await query<{ logo: string | null }>(
      `SELECT logo FROM companies WHERE is_active = true AND logo IS NOT NULL ORDER BY created_at LIMIT 1`,
    );

    const logo = rows[0]?.logo;
    if (!logo || !logo.startsWith('data:')) {
      return new Response(null, { status: 404 });
    }

    // Chrome's install prompt and the Android home-screen icon require a real
    // raster PNG at a declared square size. Render the logo centered on a white
    // square with object-fit: contain so its proportions are preserved.
    const url = new URL(req.url);
    const size = Math.min(1024, Math.max(48, Number(url.searchParams.get('size')) || 512));

    // Inset the logo into the maskable "safe zone" so the OS corner-crop of the
    // installed icon does not clip the logo.
    const pad = Math.round(size * 0.1);

    return new ImageResponse(
      (
        {
          type: 'div',
          props: {
            style: {
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#ffffff',
              padding: `${pad}px`,
            },
            children: {
              // eslint-disable-next-line @next/next/no-img-element
              type: 'img',
              props: {
                src: logo,
                style: {
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                },
              },
            },
          },
        }
      ) as React.ReactElement,
      {
        width: size,
        height: size,
        headers: {
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        },
      },
    );
  } catch {
    return new Response(null, { status: 404 });
  }
}
