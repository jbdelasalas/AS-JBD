import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);

    const rows = await query<{
      id: string; module: string; action: string; description: string | null;
    }>(
      `SELECT id, module, action, description
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
