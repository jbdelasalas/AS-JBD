export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== 'migrate-as-jbd-2026') return err('Forbidden', 403);

  try {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('artfresh2026', 10);
    const rows = await query<{ id: string; email: string }>(
      `UPDATE users
          SET email = 'admin@afcc.ph', password_hash = $1
        WHERE lower(email) IN ('admin@afcc.ph', 'admin@perpet.com.ph')
        RETURNING id, email`,
      [hash],
    );
    return ok({ updated: rows });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
