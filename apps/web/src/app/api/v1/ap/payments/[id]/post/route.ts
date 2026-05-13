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
      `SELECT sp.*, s.ap_account_id, s.name AS supplier_name
         FROM supplier_payments sp
         JOIN suppliers s ON s.id = sp.supplier_id
        WHERE sp.id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows.rows[0]) { await client.query('ROLLBACK'); return err(`Payment ${id} not found`, 404); }
    const pmt = rows.rows[0] as Record<string, unknown>;

    if (pmt.status === 'posted') { await client.query('ROLLBACK'); return err('Payment is already posted', 409); }
    if (pmt.status === 'voided') { await client.query('ROLLBACK'); return err('Payment is voided', 400); }
    if (pmt.status !== 'draft') { await client.query('ROLLBACK'); return err(`Payment is ${pmt.status}`, 400); }

    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [pmt.company_id, pmt.payment_date],
    );
    if (!periodRows.rows[0]) { await client.query('ROLLBACK'); return err(`No fiscal period for ${pmt.payment_date}`, 400); }
    const period = periodRows.rows[0];
    if (period.status === 'closed') { await client.query('ROLLBACK'); return err('Fiscal period is closed', 400); }

    // AP account
    let apAccountId = pmt.ap_account_id;
    if (!apAccountId) {
      const ctrlRows = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'LIABILITY' AND is_active = true ORDER BY code ASC LIMIT 1`,
        [pmt.company_id],
      );
      apAccountId = ctrlRows.rows[0]?.id;
      if (!apAccountId) { await client.query('ROLLBACK'); return err('No AP control account configured', 400); }
    }

    // Bank account
    let bankAccountId = pmt.bank_account_id;
    if (!bankAccountId) {
      const bankRows = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET' AND (name ILIKE '%cash%' OR name ILIKE '%bank%') AND is_active = true ORDER BY code ASC LIMIT 1`,
        [pmt.company_id],
      );
      bankAccountId = bankRows.rows[0]?.id;
      if (!bankAccountId) { await client.query('ROLLBACK'); return err('No bank/cash account configured', 400); }
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
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ap','supplier_payment',$8,'posted',$9) RETURNING *`,
      [
        pmt.company_id, pmt.branch_id ?? null, jeNo, pmt.payment_date, period.id,
        pmt.voucher_no, `CV ${pmt.voucher_no} — ${pmt.supplier_name ?? ''}`, id, auth.userId,
      ],
    );
    const je = jeRows.rows[0];

    // DR AP account (reducing liability)
    await client.query(
      `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,1,$2,$3,$4,0,'PHP',1,$4,0)`,
      [je.id, apAccountId, `AP Payment — ${pmt.voucher_no}`, amount],
    );

    // CR Bank account
    await client.query(
      `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,2,$2,$3,0,$4,'PHP',1,0,$4)`,
      [je.id, bankAccountId, `CV — ${pmt.voucher_no}`, amount],
    );

    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, jel.debit, jel.credit FROM journal_entry_lines jel WHERE jel.entry_id = $1
       ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET debit_total = account_balances.debit_total + EXCLUDED.debit_total, credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
      [je.id, period.id],
    );

    await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [je.id, auth.userId]);
    await client.query(`UPDATE supplier_payments SET status = 'posted', je_id = $2, posted_at = now() WHERE id = $1`, [id, je.id]);

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, pmt.company_id, 'post', 'supplier_payment', id],
    ).catch(() => {});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const fullRows = await query(
    `SELECT sp.*, s.name AS supplier_name, s.code AS supplier_code
       FROM supplier_payments sp
       JOIN suppliers s ON s.id = sp.supplier_id
      WHERE sp.id = $1 LIMIT 1`,
    [id],
  );
  const applications = await query(
    `SELECT bpa.*, b.internal_no, b.bill_no FROM bill_payment_applications bpa
       JOIN bills b ON b.id = bpa.bill_id WHERE bpa.payment_id = $1`,
    [id],
  );

  return ok({
    ...fullRows[0],
    amount: Number((fullRows[0] as Record<string, unknown>).amount),
    applications: applications.map((a) => ({
      ...a,
      amount_applied: Number((a as Record<string, unknown>).amount_applied),
    })),
  });
}
