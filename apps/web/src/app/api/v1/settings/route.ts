export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET() {
  const rows = await query<{ key: string; value: string }>(`SELECT key, value FROM app_settings`);
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return ok(settings);
}

export async function PUT(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  if (!auth.isSuperadmin) return err('Forbidden', 403);

  const body = await request.json() as Record<string, string>;
  for (const [key, value] of Object.entries(body)) {
    await query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()`,
      [key, String(value), auth.userId],
    );
  }
  return ok({ updated: Object.keys(body).length });
}
