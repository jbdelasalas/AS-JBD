export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return {
    ...r,
    subtotal: Number(r.subtotal),
    vat_amount: Number(r.vat_amount),
    total: Number(r.total),
    amount_applied: Number(r.amount_applied),
    unapplied_amount: Number(r.unapplied_amount),
  };
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

    const rows = await client.query(
      `SELECT cm.*, c.ar_account_id, c.name AS customer_name FROM ar_credit_memos cm JOIN customers c ON c.id = cm.customer_id WHERE cm.id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows.rows[0]) { await client.query('ROLLBACK'); return err(`Credit memo ${id} not found`, 404); }
    const cm = rows.rows[0] as Record<string, unknown>;

    if (cm.status !== 'pending_approval') {
      await client.query('ROLLBACK');
      return err(`Cannot approve: CM is ${cm.status}`, 400);
    }

    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [cm.company_id, cm.cm_date],
    );
    if (!periodRows.rows[0]) { await client.query('ROLLBACK'); return err(`No fiscal period for ${cm.cm_date}`, 400); }
    const period = periodRows.rows[0];
    if (period.status === 'closed') { await client.query('ROLLBACK'); return err('Fiscal period is closed', 400); }

    let arAccountId = cm.ar_account_id;
    if (!arAccountId) {
      const ctrlRows = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'ASSET' AND is_active = true ORDER BY code ASC LIMIT 1`,
        [cm.company_id],
      );
      arAccountId = ctrlRows.rows[0]?.id;
      if (!arAccountId) { await client.query('ROLLBACK'); return err('No AR control account configured', 400); }
    }

    const total = Number(cm.total);
    const vatAmount = Number(cm.vat_amount);
    const subtotal = Number(cm.subtotal);

    const vatAccountRows = await client.query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'LIABILITY' AND (code LIKE '%VAT%' OR name ILIKE '%output%vat%') AND is_active = true ORDER BY code ASC LIMIT 1`,
      [cm.company_id],
    );
    const vatAccountId = vatAccountRows.rows[0]?.id;

    const defaultRevRows = await client.query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'REVENUE' AND is_active = true ORDER BY code ASC LIMIT 1`,
      [cm.company_id],
    );

    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now() WHERE company_id = $1 AND doc_type = $2 AND is_active = true RETURNING prefix, current_number`,
      [cm.company_id, 'journal_voucher'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for journal_voucher', 400); }
    const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const jeRows = await client.query(
      `INSERT INTO journal_entries (company_id, branch_id, entry_no, entry_date, fiscal_period_id, reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ar','credit_memo',$8,'posted',$9) RETURNING *`,
      [cm.company_id, cm.branch_id ?? null, jeNo, cm.cm_date, period.id, cm.cm_no, `CM ${cm.cm_no} — ${cm.customer_name ?? ''}`, id, auth.userId],
    );
    const je = jeRows.rows[0];

    let lineNo = 1;
    // CR AR
    await client.query(
      `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
      [je.id, lineNo++, arAccountId, `AR reduction — ${cm.cm_no}`, total],
    );
    // DR Revenue
    if (defaultRevRows.rows[0]) {
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
        [je.id, lineNo++, defaultRevRows.rows[0].id, `Revenue reversal — ${cm.cm_no}`, subtotal],
      );
    }
    // DR Output VAT
    if (vatAmount > 0 && vatAccountId) {
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
        [je.id, lineNo++, vatAccountId, `VAT reversal — ${cm.cm_no}`, vatAmount],
      );
    }

    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
       ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET debit_total = account_balances.debit_total + EXCLUDED.debit_total, credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
      [je.id, period.id],
    );

    await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [je.id, auth.userId]);
    await client.query(
      `UPDATE ar_credit_memos SET status = 'approved', approved_by = $2, approved_at = now(), je_id = $3 WHERE id = $1`,
      [id, auth.userId, je.id],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, cm.company_id, 'approve', 'ar_credit_memo', id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const updated = await query(
    `SELECT cm.*, c.name AS customer_name, si.invoice_no FROM ar_credit_memos cm JOIN customers c ON c.id = cm.customer_id LEFT JOIN sales_invoices si ON si.id = cm.original_invoice_id WHERE cm.id = $1 LIMIT 1`,
    [id],
  );
  return ok(mapRow(updated[0] as Record<string, unknown>));
}
