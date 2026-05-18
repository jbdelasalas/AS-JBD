export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const rows = await query<{
      id: string; code: string; module: string; action: string; name: string;
    }>(
      `SELECT id, code, module, action, name
         FROM permissions
        ORDER BY module, action`
    );

    // Group by module for convenience
    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      (grouped[row.module] ??= []).push(row);
    }

    return ok({ flat: rows, grouped });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
