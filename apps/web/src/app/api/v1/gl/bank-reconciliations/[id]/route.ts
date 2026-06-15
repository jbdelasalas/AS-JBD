export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

interface WorksheetLine {
  line_id: string;
  entry_id: string;
  entry_no: string;
  entry_date: string;
  description: string | null;
  source_doc_type: string | null;
  debit: number;
  credit: number;
  cleared: boolean;
}

// GET /api/v1/gl/bank-reconciliations/[id]
// Returns the reconciliation header plus the worksheet: every posted journal
// line on the bank account's GL account that is either (a) cleared by THIS
// reconciliation, or (b) not yet cleared by any COMPLETED reconciliation.
// Also returns computed totals and the difference the user must drive to zero.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const id = params.id;

  const headRows = await query(
    `SELECT r.*, ba.account_name, ba.bank_name, ba.gl_account_id,
            a.code AS gl_code, a.name AS gl_name
       FROM bank_reconciliations r
       JOIN bank_accounts ba ON ba.id = r.bank_account_id
       LEFT JOIN accounts a ON a.id = ba.gl_account_id
      WHERE r.id = $1`,
    [id],
  );
  const head = headRows[0] as Record<string, unknown> | undefined;
  if (!head) return err('Reconciliation not found', 404);
  if (!head.gl_account_id) return err('Bank account is not linked to a GL account', 400);

  const lineRows = await query(
    `SELECT jel.id AS line_id, jel.debit, jel.credit, jel.description,
            je.id AS entry_id, je.entry_no, je.entry_date, je.source_doc_type,
            (mine.cleared IS TRUE) AS cleared
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.entry_id
       LEFT JOIN bank_reconciliation_items mine
              ON mine.journal_entry_line_id = jel.id
             AND mine.reconciliation_id = $1
      WHERE jel.account_id = $2
        AND je.status = 'posted'
        AND (
          mine.cleared IS TRUE
          OR NOT EXISTS (
            SELECT 1 FROM bank_reconciliation_items other
              JOIN bank_reconciliations r2 ON r2.id = other.reconciliation_id
             WHERE other.journal_entry_line_id = jel.id
               AND other.cleared = true
               AND r2.status = 'completed'
          )
        )
      ORDER BY je.entry_date ASC, je.entry_no ASC, jel.line_no ASC`,
    [id, head.gl_account_id],
  );

  const lines: WorksheetLine[] = lineRows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      line_id: String(row.line_id),
      entry_id: String(row.entry_id),
      entry_no: String(row.entry_no),
      entry_date: String(row.entry_date).split('T')[0],
      description: row.description ? String(row.description) : null,
      source_doc_type: row.source_doc_type ? String(row.source_doc_type) : null,
      debit: Number(row.debit),
      credit: Number(row.credit),
      cleared: row.cleared === true,
    };
  });

  const beginningBalance = Number(head.beginning_balance);
  const statementEnding = Number(head.statement_ending_balance);

  const clearedLines = lines.filter((l) => l.cleared);
  const clearedDebits = clearedLines.reduce((s, l) => s + l.debit, 0);
  const clearedCredits = clearedLines.reduce((s, l) => s + l.credit, 0);
  const clearedBalance = beginningBalance + clearedDebits - clearedCredits;

  const unclearedLines = lines.filter((l) => !l.cleared);
  const outstandingDeposits = unclearedLines.reduce((s, l) => s + l.debit, 0);
  const outstandingWithdrawals = unclearedLines.reduce((s, l) => s + l.credit, 0);

  // statement_ending = beginning + cleared_debits - cleared_credits  →  difference 0 when reconciled.
  const difference = statementEnding - clearedBalance;

  return ok({
    id: String(head.id),
    company_id: String(head.company_id),
    bank_account_id: String(head.bank_account_id),
    account_name: head.account_name,
    bank_name: head.bank_name,
    gl_code: head.gl_code,
    gl_name: head.gl_name,
    statement_date: String(head.statement_date).split('T')[0],
    statement_ending_balance: statementEnding,
    beginning_balance: beginningBalance,
    status: String(head.status),
    notes: head.notes ?? null,
    completed_at: head.completed_at ?? null,
    summary: {
      beginning_balance: beginningBalance,
      cleared_debits: clearedDebits,
      cleared_credits: clearedCredits,
      cleared_balance: clearedBalance,
      statement_ending_balance: statementEnding,
      outstanding_deposits: outstandingDeposits,
      outstanding_withdrawals: outstandingWithdrawals,
      difference,
    },
    lines,
  });
}
