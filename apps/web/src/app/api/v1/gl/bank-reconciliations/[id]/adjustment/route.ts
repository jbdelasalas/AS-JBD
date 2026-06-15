export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { assertEntryBalanced, writeAuditLog } from '@/lib/gl-integrity';

// POST /api/v1/gl/bank-reconciliations/[id]/adjustment
// Records a bank-only item (bank charge, interest income, etc.) that appears on
// the statement but not yet in the books. Creates a balanced, posted manual JE
// hitting the bank GL account and a chosen offset account, then auto-clears the
// new bank line in this reconciliation.
//
// Body: {
//   amount: number > 0,
//   direction: 'debit' | 'credit',   // debit = money INTO the bank (e.g. interest), credit = money OUT (e.g. charge)
//   offset_account_id: string,        // the expense/income account
//   description?: string,
//   entry_date?: string,              // defaults to the statement date
// }
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const id = params.id;
  const dto = await request.json().catch(() => null);
  if (!dto?.offset_account_id || dto.amount === undefined || dto.amount === null) {
    return err('offset_account_id and amount are required', 400);
  }
  const amount = Number(dto.amount);
  if (!Number.isFinite(amount) || amount <= 0) return err('amount must be a positive number', 400);
  const direction = dto.direction === 'debit' ? 'debit' : dto.direction === 'credit' ? 'credit' : null;
  if (!direction) return err("direction must be 'debit' or 'credit'", 400);

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
    if (recon.status !== 'in_progress') { await client.query('ROLLBACK'); return err('This reconciliation is completed', 409); }
    if (!recon.gl_account_id) { await client.query('ROLLBACK'); return err('Bank account is not linked to a GL account', 400); }

    const companyId = recon.company_id as string;
    const entryDate = (dto.entry_date as string) || String(recon.statement_date).split('T')[0];

    // Resolve fiscal period for the entry date; refuse if closed.
    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods
        WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [companyId, entryDate],
    );
    const period = periodRows.rows[0];
    if (!period) { await client.query('ROLLBACK'); return err(`No fiscal period defined for ${entryDate}`, 400); }
    if (period.status === 'closed') { await client.query('ROLLBACK'); return err(`Fiscal period for ${entryDate} is closed`, 400); }

    // Validate the offset account belongs to the company and is usable.
    const offsetRows = await client.query(
      `SELECT id, is_active, is_control FROM accounts WHERE id = $1 AND company_id = $2`,
      [dto.offset_account_id, companyId],
    );
    const offset = offsetRows.rows[0];
    if (!offset) { await client.query('ROLLBACK'); return err('Offset account not found in this company', 400); }
    if (!offset.is_active) { await client.query('ROLLBACK'); return err('Offset account is inactive', 400); }
    if (offset.is_control) { await client.query('ROLLBACK'); return err('Control accounts cannot be used for adjustments', 400); }

    // Issue a journal voucher number (same series pattern as manual JE creation).
    const seriesRows = await client.query(
      `UPDATE document_series
          SET current_number = GREATEST(current_number, COALESCE((SELECT MAX(NULLIF(regexp_replace(substr(je.entry_no, length(document_series.prefix) + 1), '\\D', '', 'g'), '')::bigint) FROM journal_entries je WHERE je.company_id = document_series.company_id AND je.entry_no LIKE document_series.prefix || '%'), 0)) + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = $2 AND is_active = true
        RETURNING prefix, current_number, end_number`,
      [companyId, 'journal_voucher'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for journal_voucher', 400); }
    const { prefix, current_number, end_number } = seriesRows.rows[0];
    const n = Number(current_number);
    if (end_number !== null && n > Number(end_number)) {
      await client.query('ROLLBACK');
      return err('Document series journal_voucher has been exhausted', 400);
    }
    const entryNo = `${prefix}${String(n).padStart(6, '0')}`;

    const description = (dto.description as string) || 'Bank reconciliation adjustment';

    // Header: posted immediately, tagged to the reconciliation as its source doc.
    const headerRows = await client.query(
      `INSERT INTO journal_entries
         (company_id, entry_no, entry_date, fiscal_period_id, reference, memo,
          source_module, source_doc_type, source_doc_id, status, posted_at, posted_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'bank_recon', 'bank_reconciliation', $7, 'posted', now(), $8, $8)
       RETURNING id`,
      [companyId, entryNo, entryDate, period.id, description, description, id, auth.userId],
    );
    const entryId = headerRows.rows[0].id as string;

    // Line 1: the bank GL account in the requested direction. Line 2: the offset.
    const bankDebit = direction === 'debit' ? amount : 0;
    const bankCredit = direction === 'credit' ? amount : 0;

    const bankLineRows = await client.query(
      `INSERT INTO journal_entry_lines
         (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
       VALUES ($1, 1, $2, $3, $4, $5, 'PHP', 1, $4, $5)
       RETURNING id`,
      [entryId, recon.gl_account_id, description, bankDebit, bankCredit],
    );
    const bankLineId = bankLineRows.rows[0].id as string;

    await client.query(
      `INSERT INTO journal_entry_lines
         (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
       VALUES ($1, 2, $2, $3, $4, $5, 'PHP', 1, $4, $5)`,
      [entryId, dto.offset_account_id, description, bankCredit, bankDebit],
    );

    // Balance guard before we touch posted balances.
    await assertEntryBalanced(client, entryId);

    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, jel.debit, jel.credit
         FROM journal_entry_lines jel
        WHERE jel.entry_id = $1
       ON CONFLICT (account_id, fiscal_period_id) DO UPDATE
          SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
              credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
      [entryId, period.id],
    );

    // Auto-clear the new bank line in this reconciliation: it is on the statement.
    await client.query(
      `INSERT INTO bank_reconciliation_items (reconciliation_id, journal_entry_line_id, cleared)
       VALUES ($1, $2, true)
       ON CONFLICT (reconciliation_id, journal_entry_line_id) DO UPDATE SET cleared = true`,
      [id, bankLineId],
    );

    await writeAuditLog(client, {
      userId: auth.userId,
      companyId,
      action: 'adjustment',
      entityType: 'bank_reconciliation',
      entityId: id,
      afterState: { entry_no: entryNo, direction, amount, offset_account_id: dto.offset_account_id, journal_entry_id: entryId },
    });

    await client.query('COMMIT');
    return ok({ reconciliation_id: id, journal_entry_id: entryId, entry_no: entryNo, line_id: bankLineId }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
