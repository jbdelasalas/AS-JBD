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

  const cmRows = await query<Record<string, unknown>>(
    `SELECT cm.*, s.company_id FROM bill_credit_memos cm JOIN suppliers s ON s.id = cm.supplier_id WHERE cm.id = $1`, [params.id]);
  if (!cmRows[0]) return err('Credit memo not found', 404);
  const cm = cmRows[0];
  if (cm.status !== 'draft') return err(`Credit memo is already ${cm.status}`, 409);

  const companyId = cm.company_id as string;
  const periodRows = await query(
    `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
    [companyId, cm.memo_date],
  );
  const period = periodRows[0] as Record<string, unknown> | undefined;
  if (!period || period.status === 'closed') return err('No open fiscal period for this memo date', 400);

  const lines = await query<Record<string, unknown>>(
    `SELECT l.*, a.id AS acct_id FROM bill_credit_memo_lines l LEFT JOIN accounts a ON a.id = l.expense_account_id WHERE l.memo_id = $1`,
    [params.id],
  );

  // Get AP account
  const apRows = await query(
    `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'LIABILITY'
       AND (code = '2000' OR name ILIKE '%accounts payable%') AND is_active = true ORDER BY code ASC LIMIT 1`,
    [companyId],
  );
  const apAccountId: string | null = (apRows[0] as Record<string, unknown> | undefined)?.id as string ?? null;

  // Get input VAT account
  const vatRows = await query(
    `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET'
       AND (code LIKE '%VAT%' OR name ILIKE '%input%vat%') AND is_active = true ORDER BY code ASC LIMIT 1`,
    [companyId],
  );
  const vatAccountId: string | null = (vatRows[0] as Record<string, unknown> | undefined)?.id as string ?? null;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Build JE lines: Dr AP, Cr Expense accounts, Cr Input VAT
    const jeLines: Array<{ account_id: string; description: string; debit: number; credit: number }> = [];

    let totalCredit = 0;
    let totalVat = 0;

    for (const l of lines) {
      const subtotal = Number(l.line_subtotal);
      const vatAmt = Number(l.line_vat);
      totalCredit += subtotal;
      totalVat += vatAmt;

      const expAcct = l.acct_id as string | null;
      if (expAcct && subtotal !== 0) {
        jeLines.push({ account_id: expAcct, description: `CM — ${l.description} (${cm.memo_no})`, debit: 0, credit: subtotal });
      }
    }

    // Cr Input VAT (reversal)
    if (totalVat > 0 && vatAccountId) {
      jeLines.push({ account_id: vatAccountId, description: `Input VAT reversal — ${cm.memo_no}`, debit: 0, credit: totalVat });
    }

    // Dr Accounts Payable
    const totalDebit = parseFloat((totalCredit + totalVat).toFixed(2));
    if (apAccountId && totalDebit > 0) {
      jeLines.unshift({ account_id: apAccountId, description: `AP — Bill Credit Memo ${cm.memo_no}`, debit: totalDebit, credit: 0 });
    }

    let jeId: string | null = null;
    if (jeLines.length > 0) {
      const seriesRows = await client.query(
        `UPDATE document_series SET current_number = GREATEST(current_number, COALESCE((SELECT MAX(NULLIF(regexp_replace(substr(je.entry_no, length(document_series.prefix) + 1), '\\D', '', 'g'), '')::bigint) FROM journal_entries je WHERE je.company_id = document_series.company_id AND je.entry_no LIKE document_series.prefix || '%'), 0)) + 1, updated_at = now()
           WHERE company_id = $1 AND doc_type = 'journal_voucher' AND is_active = true
           RETURNING prefix, current_number`,
        [companyId],
      );
      if (seriesRows.rows[0]) {
        const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;
        const jeInsert = await client.query(
          `INSERT INTO journal_entries (company_id, entry_no, entry_date, fiscal_period_id,
             reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,'ap','bill_credit_memo',$7,'posted',$8) RETURNING id`,
          [companyId, jeNo, cm.memo_date, period.id,
           cm.memo_no, `Bill Credit Memo ${cm.memo_no}`, params.id, auth.userId],
        );
        jeId = jeInsert.rows[0].id;
        for (let i = 0; i < jeLines.length; i++) {
          const jl = jeLines[i];
          await client.query(
            `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
             VALUES ($1,$2,$3,$4,$5,$6,'PHP',1,$5,$6)`,
            [jeId, i + 1, jl.account_id, jl.description, jl.debit, jl.credit],
          );
        }
        await client.query(
          `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
           SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
           ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET
             debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
             credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
          [jeId, period.id],
        );
        await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [jeId, auth.userId]);
      }
    }

    await client.query(
      `UPDATE bill_credit_memos SET status = 'posted', je_id = $2, updated_at = now() WHERE id = $1`,
      [params.id, jeId],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'post','bill_credit_memo',$3)`,
      [auth.userId, companyId, params.id],
    ).catch(() => {});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const updated = await query(
    `SELECT cm.*, s.name AS supplier_name, s.code AS supplier_code FROM bill_credit_memos cm JOIN suppliers s ON s.id = cm.supplier_id WHERE cm.id = $1 LIMIT 1`,
    [params.id],
  );
  return ok(updated[0]);
}
