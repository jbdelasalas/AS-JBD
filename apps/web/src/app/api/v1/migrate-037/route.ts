export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];

  // 037a — allow_negative_inventory column on companies
  try {
    await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS allow_negative_inventory boolean NOT NULL DEFAULT false`);
    results.push('ok: 037a companies.allow_negative_inventory column');
  } catch (e) { results.push(`err: 037a — ${(e as Error).message}`); }

  // 037b — seed allow_negative_inventory in feature_flags table
  try {
    await query(
      `INSERT INTO feature_flags (name, enabled, description)
       VALUES ('allow_negative_inventory', false, 'When enabled, posting transactions that reduce stock below zero is permitted.')
       ON CONFLICT (name) DO NOTHING`,
    );
    results.push('ok: 037b feature_flags allow_negative_inventory seeded');
  } catch (e) { results.push(`err: 037b — ${(e as Error).message}`); }

  return ok({ results });
}
