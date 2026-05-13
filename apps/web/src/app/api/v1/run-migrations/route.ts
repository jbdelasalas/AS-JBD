export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key        text PRIMARY KEY,
        value      text NOT NULL,
        updated_by uuid,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    results.push('app_settings table: ok');
  } catch (e) { results.push(`app_settings table: ${(e as Error).message}`); }

  const seeds = [
    ['dark_mode', 'false'],
    ['brand_theme', 'blue'],
    ['login_bg', ''],
    ['company_name', ''],
  ];
  for (const [key, value] of seeds) {
    try {
      await query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [key, value],
      );
      results.push(`seed ${key}: ok`);
    } catch (e) { results.push(`seed ${key}: ${(e as Error).message}`); }
  }

  const cols = [
    ['phone', 'varchar(50)'],
    ['email', 'varchar(200)'],
    ['website', 'varchar(200)'],
    ['logo', 'text'],
  ];
  for (const [col, type] of cols) {
    try {
      await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      results.push(`companies.${col}: ok`);
    } catch (e) { results.push(`companies.${col}: ${(e as Error).message}`); }
  }

  return ok({ results });
}
