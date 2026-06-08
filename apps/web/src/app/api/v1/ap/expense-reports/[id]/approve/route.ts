export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return { ...r, total: Number(r.total) };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const id = params.id;
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const erRows = await client.query(
      `SELECT er.*, e.full_name AS employee_name
         FROM employee_expense_reports er
         JOIN employees e ON e.id = er.employee_id
        WHERE er.id = $1 FOR UPDATE`,
      [id],
    );
    if (!erRows.rows[0]) { await client.query('ROLLBACK'); return err(`Expense report ${id} not found`, 404); }
    const er = erRows.rows[0] as Record<string, unknown>;

    if (er.status !== 'pending_approval') {
      await client.query('ROLLBACK');
      return err(`Cannot approve: report is ${er.status}`, 400);
    }

    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [er.company_id, er.report_date],
    );
    if (!periodRows.rows[0]) { await client.query('ROLLBACK'); return err(`No fiscal period for ${er.report_date}`, 400); }
    const period = periodRows.rows[0];
    if (period.status === 'closed') { await client.query('ROLLBACK'); return err('Fiscal period is closed', 400); }

    // Get expense lines with accounts
    const lineRows = await client.query(
      `SELECT erl.*, a.code AS account_code
         FROM expense_report_lines erl
         LEFT JOIN accounts a ON a.id = erl.expense_account_id
        WHERE erl.er_id = $1 ORDER BY erl.line_no`,
      [id],
    );

    // Resolve default expense account if a line has none
    const defaultExpRows = await client.query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'EXPENSE' AND is_active = true ORDER BY code ASC LIMIT 1`,
      [er.company_id],
    );
    const defaultExpAccountId = defaultExpRows.rows[0]?.id ?? null;

    // Resolve AP control account (CR side — company owes employee)
    const apControlRows = await client.query(
      `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'LIABILITY' AND is_active = true ORDER BY code ASC LIMIT 1`,
      [er.company_id],
    );
    const apAccountId = apControlRows.rows[0]?.id;
    if (!apAccountId) { await client.query('ROLLBACK'); return err('No AP control account configured', 400); }

    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = $2 AND is_active = true
        RETURNING prefix, current_number`,
      [er.company_id, 'journal_voucher'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for journal_voucher', 400); }
    const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const jeRows = await client.query(
      `INSERT INTO journal_entries
         (company_id, branch_id, entry_no, entry_date, fiscal_period_id, reference, memo,
          source_module, source_doc_type, source_doc_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ap','expense_report',$8,'posted',$9) RETURNING *`,
      [
        er.company_id, er.branch_id ?? null, jeNo, er.report_date,
        period.id, er.er_no,
        `ER ${er.er_no} — ${er.employee_name ?? ''}`,
        id, auth.userId,
      ],
    );
    const je = jeRows.rows[0];

    let lineNo = 1;
    // DR expense account per line
    for (const l of lineRows.rows) {
      const expAccId = l.expense_account_id ?? defaultExpAccountId;
      if (!expAccId) continue;
      await client.query(
        `INSERT INTO journal_entry_lines
           (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
        [je.id, lineNo++, expAccId, l.description, Number(l.amount).toFixed(2)],
      );
    }

    // CR AP / employee payable (total)
    await client.query(
      `INSERT INTO journal_entry_lines
         (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
       VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
      [je.id, lineNo++, apAccountId, `Employee reimbursable — ${er.er_no}`, Number(er.total).toFixed(2)],
    );

    // Update account balances
    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit)
         FROM journal_entry_lines jel WHERE jel.entry_id = $1
        GROUP BY jel.account_id
       ON CONFLICT (account_id, fiscal_period_id)
       DO UPDATE SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
                     credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
      [je.id, period.id],
    );

    await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [je.id, auth.userId]);
    await client.query(
      `UPDATE employee_expense_reports SET status = 'approved', approved_by = $2, approved_at = now(), je_id = $3 WHERE id = $1`,
      [id, auth.userId, je.id],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [auth.userId, er.company_id, 'approve', 'expense_report', id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const updated = await query(
    `SELECT er.*, e.full_name AS employee_name, e.employee_no
       FROM employee_expense_reports er
       JOIN employees e ON e.id = er.employee_id
      WHERE er.id = $1 LIMIT 1`,
    [id],
  );
  return ok(mapRow(updated[0] as Record<string, unknown>));
}
