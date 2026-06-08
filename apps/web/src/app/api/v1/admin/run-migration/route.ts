export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// One-time migration runner — superadmin only
export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  if (!auth.isSuperadmin) return err('Forbidden — superadmin only', 403);

  const results: string[] = [];

  try {
    // Migration 022: drop FK on delivery_receipts.tally_sheet_id
    await query(`ALTER TABLE delivery_receipts DROP CONSTRAINT IF EXISTS delivery_receipts_tally_sheet_id_fkey`);
    results.push('Dropped FK constraint delivery_receipts_tally_sheet_id_fkey');

    await query(`ALTER TABLE delivery_receipts ADD COLUMN IF NOT EXISTS tally_sheet_id uuid`);
    results.push('Ensured delivery_receipts.tally_sheet_id column exists (no FK)');

    await query(`CREATE INDEX IF NOT EXISTS idx_dr_tally_sheet ON delivery_receipts (tally_sheet_id)`);
    results.push('Ensured index idx_dr_tally_sheet');

    return ok({ success: true, results });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
