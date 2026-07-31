export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// Focused migration: adds only the PPC-style header columns to
// employee_expense_reports. Runs against BOTH the public and sandbox
// schemas, since the app serves either depending on the x-db-mode header.
// Idempotent.
export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const headerCols: [string, string][] = [
    ['department',       'varchar(200)'],
    ['fund_class',       'varchar(200)'],
    ['report_class',     'varchar(200)'],
    ['location_text',    'varchar(200)'],
    ['external_id_code', 'varchar(100)'],
    ['pcf_series',       'varchar(100)'],
  ];
  // Line-level columns the create route + form now reference. If a prior
  // migration for these timed out, the INSERT 500s — ensure they exist.
  const lineCols: [string, string][] = [
    ['supplier_id',  'uuid'],
    ['supplier_tin', 'varchar(50)'],
    ['tax_code_id',  'uuid'],
  ];

  const results: string[] = [];
  for (const schema of ['public', 'sandbox'] as const) {
    const pool = getPool(schema === 'sandbox');
    for (const [col, type] of headerCols) {
      try {
        await pool.query(
          `ALTER TABLE ${schema}.employee_expense_reports ADD COLUMN IF NOT EXISTS ${col} ${type}`,
        );
        results.push(`${schema}.employee_expense_reports.${col}: ok`);
      } catch (e) {
        results.push(`${schema}.employee_expense_reports.${col}: ${(e as Error).message}`);
      }
    }
    for (const [col, type] of lineCols) {
      try {
        await pool.query(
          `ALTER TABLE ${schema}.expense_report_lines ADD COLUMN IF NOT EXISTS ${col} ${type}`,
        );
        results.push(`${schema}.expense_report_lines.${col}: ok`);
      } catch (e) {
        results.push(`${schema}.expense_report_lines.${col}: ${(e as Error).message}`);
      }
    }
  }

  return ok({ results });
}
