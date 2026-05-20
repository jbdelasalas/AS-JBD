export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const rows = await client.query(
      `SELECT b.*, s.ap_account_id, s.name AS supplier_name
         FROM bills b
         JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.id = $1 FOR UPDATE`,
      [params.id],
    );
    if (!rows.rows[0]) { await client.query('ROLLBACK'); return err('Bill not found', 404); }
    const bill = rows.rows[0] as Record<string, unknown>;

    if (!['draft', 'pending_approval'].includes(String(bill.status))) {
      await client.query('ROLLBACK');
      return err(`Bill is ${bill.status} — only draft or pending_approval bills can be approved`, 400);
    }

    // Fiscal period
    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [bill.company_id, bill.bill_date],
    );
    if (!periodRows.rows[0]) { await client.query('ROLLBACK'); return err(`No fiscal period for ${bill.bill_date}`, 400); }
    const period = periodRows.rows[0] as Record<string, unknown>;
    if (period.status === 'closed') { await client.query('ROLLBACK'); return err('Fiscal period is closed', 400); }

    // AP account
    let apAccountId = bill.ap_account_id as string | null;
    if (!apAccountId) {
      const ctrlRows = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'LIABILITY' AND is_active = true ORDER BY code LIMIT 1`,
        [bill.company_id],
      );
      apAccountId = ctrlRows.rows[0]?.id ?? null;
      if (!apAccountId) { await client.query('ROLLBACK'); return err('No AP control account configured', 400); }
    }

    // Input VAT account
    const vatRows = await client.query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET' AND (code ILIKE '%vat%' OR name ILIKE '%input%vat%') AND is_active = true ORDER BY code LIMIT 1`,
      [bill.company_id],
    );
    const vatAccountId = vatRows.rows[0]?.id ?? null;

    // Default expense account fallback
    const defExpRows = await client.query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'EXPENSE' AND is_active = true ORDER BY code LIMIT 1`,
      [bill.company_id],
    );
    const defaultExpAcctId = defExpRows.rows[0]?.id ?? null;

    // Bill lines
    const lineRows = await client.query(
      `SELECT bl.*, COALESCE(bl.expense_account_id, i.expense_account_id) AS eff_expense_acct
         FROM bill_lines bl
         LEFT JOIN items i ON i.id = bl.item_id
        WHERE bl.bill_id = $1 ORDER BY bl.line_no`,
      [params.id],
    );

    const vatAmount = Number(bill.vat_amount);
    const total = Number(bill.total);

    // Get JE doc number
    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = $2 AND is_active = true
        RETURNING prefix, current_number`,
      [bill.company_id, 'journal_voucher'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for journal_voucher', 400); }
    const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const jeRows = await client.query(
      `INSERT INTO journal_entries
         (company_id, branch_id, entry_no, entry_date, fiscal_period_id, reference, memo,
          source_module, source_doc_type, source_doc_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ap','bill',$8,'posted',$9) RETURNING *`,
      [
        bill.company_id, bill.branch_id ?? null, jeNo, bill.bill_date, period.id,
        bill.internal_no, `Bill ${bill.internal_no} — ${bill.supplier_name}`,
        params.id, auth.userId,
      ],
    );
    const je = jeRows.rows[0] as Record<string, unknown>;

    let lineNo = 1;

    // DR Expense per line
    for (const l of lineRows.rows as Array<Record<string, unknown>>) {
      const acctId = (l.eff_expense_acct as string | null) ?? defaultExpAcctId;
      if (!acctId) continue;
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
        [je.id, lineNo++, acctId, l.description, Number(l.line_subtotal)],
      );
    }

    // DR Input VAT
    if (vatAmount > 0 && vatAccountId) {
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
        [je.id, lineNo++, vatAccountId, `Input VAT — ${bill.internal_no}`, vatAmount],
      );
    }

    // CR Accounts Payable
    await client.query(
      `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
       VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
      [je.id, lineNo++, apAccountId, `AP — ${bill.internal_no}`, total],
    );

    // Update account balances
    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, jel.debit, jel.credit FROM journal_entry_lines jel WHERE jel.entry_id = $1
       ON CONFLICT (account_id, fiscal_period_id) DO UPDATE
         SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
             credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
      [je.id, period.id],
    );

    await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [je.id, auth.userId]);
    await client.query(
      `UPDATE bills SET status = 'approved', approved_by = $2, approved_at = now(), je_id = $3, updated_at = now() WHERE id = $1`,
      [params.id, auth.userId, je.id],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5)`,
      [auth.userId, bill.company_id, 'approve', 'bill', params.id],
    ).catch(() => {});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Internal server error', 500);
  } finally {
    client.release();
  }

  const updated = await query(
    `SELECT b.*, s.name AS supplier_name, s.code AS supplier_code FROM bills b JOIN suppliers s ON s.id = b.supplier_id WHERE b.id = $1 LIMIT 1`,
    [params.id],
  );
  return ok(updated[0]);
}
