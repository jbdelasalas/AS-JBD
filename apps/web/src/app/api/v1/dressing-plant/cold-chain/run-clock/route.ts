export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Storage clock — accrues daily cold-storage rental for every in_storage box
// older than 24h. Intended to be called hourly (Vercel Cron / pg_cron); can also
// be triggered manually from the Cold Chain page. Idempotent per box per day.

export async function POST(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);

  try {
    const [res] = await query<{ rows_written: number }>(
      `SELECT dp_run_storage_clock($1) AS rows_written`,
      [companyId],
    );
    return ok({ rows_written: res.rows_written });
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to run storage clock', 500);
  }
}
