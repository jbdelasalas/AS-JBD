export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { writeAuditLog } from '@/lib/gl-integrity';

const PENNY = 0.005; // same rounding tolerance used across GL integrity checks

// POST /api/v1/gl/bank-reconciliations/[id]/complete
// Body: { force?: boolean }
// Recomputes the cleared balance and difference from the database (never trusts
// the client), refuses to complete a non-zero difference unless force is set,
// then locks the reconciliation.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const id = params.id;
  const dto = await request.json().catch(() => ({}));
  const force = dto?.force === true;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const reconRows = await client.query(
      `SELECT r.*, ba.gl_account_id
         FROM bank_reconciliations r
         JOIN bank_accounts ba ON ba.id = r.bank_account_id
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [id],
    );
    const recon = reconRows.rows[0];
    if (!recon) { await client.query('ROLLBACK'); return err('Reconciliation not found', 404); }
    if (recon.status === 'completed') { await client.query('ROLLBACK'); return err('Already completed', 409); }
    if (!recon.gl_account_id) { await client.query('ROLLBACK'); return err('Bank account is not linked to a GL account', 400); }

    // Guarantee no cleared line is locked by another completed reconciliation.
    const conflictRows = await client.query(
      `SELECT je.entry_no
         FROM bank_reconciliation_items i
         JOIN journal_entry_lines jel ON jel.id = i.journal_entry_line_id
         JOIN journal_entries je ON je.id = jel.entry_id
        WHERE i.reconciliation_id = $1 AND i.cleared = true
          AND EXISTS (
            SELECT 1 FROM bank_reconciliation_items o
              JOIN bank_reconciliations r2 ON r2.id = o.reconciliation_id
             WHERE o.journal_entry_line_id = i.journal_entry_line_id
               AND o.cleared = true AND r2.status = 'completed' AND r2.id <> $1
          )`,
      [id],
    );
    if (conflictRows.rows[0]) {
      await client.query('ROLLBACK');
      return err(
        `Some cleared transactions were already reconciled elsewhere (e.g. ${conflictRows.rows[0].entry_no}). Uncheck them and try again.`,
        409,
      );
    }

    // Recompute cleared totals from the source of truth.
    const totalsRows = await client.query(
      `SELECT COALESCE(SUM(jel.debit), 0) AS d, COALESCE(SUM(jel.credit), 0) AS c
         FROM bank_reconciliation_items i
         JOIN journal_entry_lines jel ON jel.id = i.journal_entry_line_id
        WHERE i.reconciliation_id = $1 AND i.cleared = true`,
      [id],
    );
    const clearedDebits = Number(totalsRows.rows[0].d);
    const clearedCredits = Number(totalsRows.rows[0].c);
    const beginningBalance = Number(recon.beginning_balance);
    const statementEnding = Number(recon.statement_ending_balance);
    const clearedBalance = beginningBalance + clearedDebits - clearedCredits;
    const difference = statementEnding - clearedBalance;

    if (Math.abs(difference) > PENNY && !force) {
      await client.query('ROLLBACK');
      return err(
        `Cannot complete: the difference is ${difference.toFixed(2)}, not zero. ` +
          `Clear the remaining transactions, record bank-only items (charges/interest) as an adjustment, ` +
          `or pass force to complete with a recorded variance.`,
        400,
      );
    }

    await client.query(
      `UPDATE bank_reconciliations
          SET status = 'completed', cleared_balance = $2, difference = $3,
              completed_by = $4, completed_at = now()
        WHERE id = $1`,
      [id, clearedBalance, difference, auth.userId],
    );

    await writeAuditLog(client, {
      userId: auth.userId,
      companyId: recon.company_id,
      action: 'complete',
      entityType: 'bank_reconciliation',
      entityId: id,
      afterState: {
        statement_ending_balance: statementEnding,
        beginning_balance: beginningBalance,
        cleared_balance: clearedBalance,
        difference,
        forced: force && Math.abs(difference) > PENNY,
      },
    });

    await client.query('COMMIT');
    return ok({ id, status: 'completed', cleared_balance: clearedBalance, difference });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
