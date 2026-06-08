export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];

  // 039a — add transfer_je_id to tally_sheets
  try {
    await query(`ALTER TABLE tally_sheets ADD COLUMN IF NOT EXISTS transfer_je_id uuid REFERENCES journal_entries(id)`);
    results.push('ok: 039a tally_sheets.transfer_je_id column added');
  } catch (e) { results.push(`err: 039a — ${(e as Error).message}`); }

  return ok({ results });
}
