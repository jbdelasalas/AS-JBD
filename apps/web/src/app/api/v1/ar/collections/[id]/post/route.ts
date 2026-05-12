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
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const id = params.id;
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const rows = await client.query(
      `SELECT cp.*, c.ar_account_id, c.name AS customer_name FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id WHERE cp.id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows.rows[0]) { await client.query('ROLLBACK'); return err(`Payment ${id} not found`, 404); }
    const pmt = rows.rows[0] as Record<string, unknown>;

    if (pmt.status !== 'draft') { await client.query('ROLLBACK'); return err(`Payment is already ${pmt.status}`, 409); }

    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [pmt.company_id, pmt.payment_date],
    );
    if (!periodRows.rows[0]) { await client.query('ROLLBACK'); return err(`No fiscal period for ${pmt.payment_date}`, 400); }
    const period = periodRows.rows[0];
    if (period.status === 'closed') { await client.query('ROLLBACK'); return err('Fiscal period is closed', 400); }

    let arAccountId = pmt.ar_account_id;
    if (!arAccountId) {
      const ctrlRows = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'ASSET' AND is_active = true ORDER BY code ASC LIMIT 1`,
        [pmt.company_id],
      );
      arAccountId = ctrlRows.rows[0]?.id;
      if (!arAccountId) { await client.query('ROLLBACK'); return err('No AR control account configured', 400); }
    }

    let cashAccountId = pmt.bank_account_id;
    if (!cashAccountId) {
      const cashRows = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET' AND (name ILIKE '%cash%' OR name ILIKE '%bank%') AND is_active = true ORDER BY code ASC LIMIT 1`,
        [pmt.company_id],
      );
      cashAccountId = cashRows.rows[0]?.id;
      if (!cashAccountId) { await client.query('ROLLBACK'); return err('No cash/bank account configured', 400); }
    }

    const amount = Number(pmt.amount);

    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now() WHERE company_id = $1 AND doc_type = $2 AND is_active = true RETURNING prefix, current_number`,
      [pmt.company_id, 'journal_voucher'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for journal_voucher', 400); }
    const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const jeRows = await client.query(
      `INSERT INTO journal_entries (company_id, branch_id, entry_no, entry_date, fiscal_period_id, reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ar','customer_payment',$8,'posted',$9) RETURNING *`,
      [pmt.company_id, pmt.branch_id ?? null, jeNo, pmt.payment_date, period.id, pmt.receipt_no, `OR ${pmt.receipt_no} — ${pmt.customer_name ?? ''}`, id, auth.userId],
    );
    const je = jeRows.rows[0];

    // DR Cash/Bank
    await client.query(
      `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,1,$2,$3,$4,0,'PHP',1,$4,0)`,
      [je.id, cashAccountId, `Receipt — ${pmt.receipt_no}`, amount],
    );
    // CR AR
    await client.query(
      `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,2,$2,$3,0,$4,'PHP',1,0,$4)`,
      [je.id, arAccountId, `AR payment — ${pmt.receipt_no}`, amount],
    );

    // Update account balances
    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, jel.debit, jel.credit FROM journal_entry_lines jel WHERE jel.entry_id = $1
       ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET debit_total = account_balances.debit_total + EXCLUDED.debit_total, credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
      [je.id, period.id],
    );

    await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [je.id, auth.userId]);

    // Apply to invoices
    const apps = await client.query(
      `SELECT pa.invoice_id, pa.amount_applied FROM payment_applications WHERE payment_id = $1`,
      [id],
    );
    for (const app of apps.rows as Array<{ invoice_id: string; amount_applied: string }>) {
      const applied = Number(app.amount_applied);
      const invRows = await client.query(`SELECT balance, total FROM sales_invoices WHERE id = $1 FOR UPDATE`, [app.invoice_id]);
      if (!invRows.rows[0]) continue;

      const newBalance = Number(invRows.rows[0].balance) - applied;
      const newStatus = newBalance <= 0.001 ? 'paid' : 'partially_paid';
      await client.query(
        `UPDATE sales_invoices SET balance = $2, amount_paid = amount_paid + $3, status = $4 WHERE id = $1`,
        [app.invoice_id, Math.max(newBalance, 0).toFixed(2), applied.toFixed(2), newStatus],
      );
    }

    await client.query(`UPDATE customer_payments SET status = 'posted', posted_at = now(), je_id = $2 WHERE id = $1`, [id, je.id]);

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, pmt.company_id, 'post', 'customer_payment', id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const fullHeaders = await query(
    `SELECT cp.*, c.name AS customer_name, c.code AS customer_code FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id WHERE cp.id = $1 LIMIT 1`,
    [id],
  );
  const applications = await query(
    `SELECT pa.*, si.invoice_no FROM payment_applications pa JOIN sales_invoices si ON si.id = pa.invoice_id WHERE pa.payment_id = $1`,
    [id],
  );

  const h = fullHeaders[0] as Record<string, unknown>;
  return ok({
    ...h,
    amount: Number(h.amount),
    unapplied_amount: Number(h.unapplied_amount ?? 0),
    applications: applications.map((a) => ({ ...a, amount_applied: Number((a as Record<string, unknown>).amount_applied) })),
  });
}
