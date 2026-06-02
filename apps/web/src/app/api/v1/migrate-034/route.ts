export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const steps: [string, string][] = [
    ['bills.ewt_code_id',        `ALTER TABLE bills       ADD COLUMN IF NOT EXISTS ewt_code_id  uuid REFERENCES tax_codes(id)`],
    ['bill_lines.ewt_rate',      `ALTER TABLE bill_lines  ADD COLUMN IF NOT EXISTS ewt_rate      numeric(5,2)  DEFAULT 0`],
    ['bill_lines.ewt_amount',    `ALTER TABLE bill_lines  ADD COLUMN IF NOT EXISTS ewt_amount    numeric(18,2) DEFAULT 0`],
    ['bill_lines.ewt_code_id',   `ALTER TABLE bill_lines  ADD COLUMN IF NOT EXISTS ewt_code_id   uuid REFERENCES tax_codes(id)`],
    ['suppliers.bir_atc_code',   `ALTER TABLE suppliers   ADD COLUMN IF NOT EXISTS bir_atc_code  varchar(10)`],
  ];

  const results: string[] = [];
  for (const [label, sql] of steps) {
    try {
      await query(sql);
      results.push(`ok: ${label}`);
    } catch (e) {
      results.push(`err: ${label} — ${(e as Error).message}`);
    }
  }

  return ok({ results });
}
