export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { reconcileAccountBalances } from '@/lib/gl-integrity';

/**
 * Self-audit endpoint: compares the denormalized `account_balances` cache
 * against the source of truth (posted journal_entry_lines). An empty `drift`
 * array is the proof that every report agrees with the ledger.
 *
 * GET /api/v1/gl/reconcile-balances?company_id=...
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const client = await getPool().connect();
  try {
    const drift = await reconcileAccountBalances(client, companyId);
    return ok({
      checked_at: new Date().toISOString(),
      is_reconciled: drift.length === 0,
      drift_count: drift.length,
      drift,
    });
  } catch (e) {
    return err((e as Error).message ?? 'Reconciliation failed', 500);
  } finally {
    client.release();
  }
}
