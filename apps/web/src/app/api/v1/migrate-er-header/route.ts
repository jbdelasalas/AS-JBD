export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// Focused migration: adds only the PPC-style header columns to
// employee_expense_reports. Split out from run-migrations so it finishes
// well within the function time limit. Idempotent.
export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];
  const cols: [string, string][] = [
    ['department',       'varchar(200)'],
    ['fund_class',       'varchar(200)'],
    ['report_class',     'varchar(200)'],
    ['location_text',    'varchar(200)'],
    ['external_id_code', 'varchar(100)'],
    ['pcf_series',       'varchar(100)'],
  ];
  for (const [col, type] of cols) {
    try {
      await query(`ALTER TABLE employee_expense_reports ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      results.push(`employee_expense_reports.${col}: ok`);
    } catch (e) { results.push(`employee_expense_reports.${col}: ${(e as Error).message}`); }
  }

  return ok({ results });
}
