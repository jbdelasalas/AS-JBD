export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== 'migrate-as-jbd-2026') return err('Forbidden', 403);

  const results: string[] = [];
  for (const col of [
    'inventory_account_id',
    'cogs_account_id',
    'revenue_account_id',
    'purchase_variance_account_id',
  ]) {
    try {
      await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS ${col} uuid REFERENCES accounts(id)`);
      results.push(`items.${col}: ok`);
    } catch (e) {
      results.push(`items.${col}: ${(e as Error).message}`);
    }
  }
  return ok({ results });
}
