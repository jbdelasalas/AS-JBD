export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// Add the four dimension FKs (Location/Cost Center/Building/Grow) to expense
// reports, on both the header and each line — mirroring how sales_tally_sheets
// already carries branch_id / cost_center_id / building_id / grow_reference_id.
// All steps are idempotent (ADD COLUMN IF NOT EXISTS).
export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const steps: [string, string][] = [
    // ── header: employee_expense_reports ─────────────────────────────────────
    ['eer.location_id',       `ALTER TABLE employee_expense_reports ADD COLUMN IF NOT EXISTS location_id       uuid REFERENCES branches(id)`],
    ['eer.cost_center_id',    `ALTER TABLE employee_expense_reports ADD COLUMN IF NOT EXISTS cost_center_id    uuid REFERENCES cost_centers(id)`],
    ['eer.building_id',       `ALTER TABLE employee_expense_reports ADD COLUMN IF NOT EXISTS building_id       uuid REFERENCES farm_buildings(id)`],
    ['eer.grow_reference_id', `ALTER TABLE employee_expense_reports ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],

    // ── lines: expense_report_lines ──────────────────────────────────────────
    ['erl.location_id',       `ALTER TABLE expense_report_lines ADD COLUMN IF NOT EXISTS location_id       uuid REFERENCES branches(id)`],
    ['erl.cost_center_id',    `ALTER TABLE expense_report_lines ADD COLUMN IF NOT EXISTS cost_center_id    uuid REFERENCES cost_centers(id)`],
    ['erl.building_id',       `ALTER TABLE expense_report_lines ADD COLUMN IF NOT EXISTS building_id       uuid REFERENCES farm_buildings(id)`],
    ['erl.grow_reference_id', `ALTER TABLE expense_report_lines ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
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
