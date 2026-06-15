export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// PATCH /api/v1/gl/bank-reconciliations/[id]/items
// Body: { line_id: string, cleared: boolean }
// Toggles whether a journal line is cleared by this reconciliation. Clearing a
// line that was already cleared by a COMPLETED reconciliation is refused.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const id = params.id;
  const dto = await request.json().catch(() => null);
  if (!dto?.line_id || typeof dto.cleared !== 'boolean') {
    return err('line_id and cleared (boolean) are required', 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const reconRows = await client.query(
      `SELECT r.id, r.status, ba.gl_account_id
         FROM bank_reconciliations r
         JOIN bank_accounts ba ON ba.id = r.bank_account_id
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [id],
    );
    const recon = reconRows.rows[0];
    if (!recon) { await client.query('ROLLBACK'); return err('Reconciliation not found', 404); }
    if (recon.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return err('This reconciliation is completed and can no longer be edited', 409);
    }

    // The line must be a posted line on this bank account's GL account.
    const lineRows = await client.query(
      `SELECT jel.id
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.entry_id
        WHERE jel.id = $1 AND jel.account_id = $2 AND je.status = 'posted'`,
      [dto.line_id, recon.gl_account_id],
    );
    if (!lineRows.rows[0]) {
      await client.query('ROLLBACK');
      return err('Journal line is not a posted transaction on this bank account', 400);
    }

    if (dto.cleared) {
      // Refuse if another COMPLETED reconciliation already cleared this line.
      const lockedRows = await client.query(
        `SELECT 1 FROM bank_reconciliation_items i
           JOIN bank_reconciliations r2 ON r2.id = i.reconciliation_id
          WHERE i.journal_entry_line_id = $1 AND i.cleared = true
            AND r2.status = 'completed' AND r2.id <> $2
          LIMIT 1`,
        [dto.line_id, id],
      );
      if (lockedRows.rows[0]) {
        await client.query('ROLLBACK');
        return err('This transaction was already cleared by a completed reconciliation', 409);
      }
      await client.query(
        `INSERT INTO bank_reconciliation_items (reconciliation_id, journal_entry_line_id, cleared)
         VALUES ($1, $2, true)
         ON CONFLICT (reconciliation_id, journal_entry_line_id)
         DO UPDATE SET cleared = true`,
        [id, dto.line_id],
      );
    } else {
      await client.query(
        `DELETE FROM bank_reconciliation_items
          WHERE reconciliation_id = $1 AND journal_entry_line_id = $2`,
        [id, dto.line_id],
      );
    }

    await client.query('COMMIT');
    return ok({ line_id: dto.line_id, cleared: dto.cleared });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
