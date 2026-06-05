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

    let billRows: Record<string, unknown>[];
    await client.query('SAVEPOINT sp_bill_select');
    try {
      const r = await client.query(
        `SELECT b.*, s.ap_account_id, s.name AS supplier_name, s.ewt_rate AS supplier_ewt_rate,
                COALESCE(s.bir_atc_code, etc.bir_atc_code) AS supplier_atc_code,
                etc.account_id AS ewt_account_id, etc.code AS ewt_code, etc.rate_pct AS ewt_code_rate
           FROM bills b
           JOIN suppliers s ON s.id = b.supplier_id
           LEFT JOIN tax_codes etc ON etc.id = b.ewt_code_id
          WHERE b.id = $1 FOR UPDATE`,
        [params.id],
      );
      billRows = r.rows;
      await client.query('RELEASE SAVEPOINT sp_bill_select');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT sp_bill_select');
      const r = await client.query(
        `SELECT b.*, s.ap_account_id, s.name AS supplier_name, s.ewt_rate AS supplier_ewt_rate
           FROM bills b
           JOIN suppliers s ON s.id = b.supplier_id
          WHERE b.id = $1 FOR UPDATE`,
        [params.id],
      );
      billRows = r.rows;
    }
    if (!billRows[0]) { await client.query('ROLLBACK'); return err('Bill not found', 404); }
    const bill = billRows[0] as Record<string, unknown>;

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

    // Bill lines (needed for non-PO bills)
    const lineRows = await client.query(
      `SELECT bl.*, bl.expense_account_id AS eff_expense_acct
         FROM bill_lines bl
        WHERE bl.bill_id = $1 ORDER BY bl.line_no`,
      [params.id],
    );

    // Default expense account fallback (non-PO bills)
    const defExpRows = await client.query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'EXPENSE' AND is_active = true ORDER BY code LIMIT 1`,
      [bill.company_id],
    );
    const defaultExpAcctId = defExpRows.rows[0]?.id ?? null;

    // GRNI account (for PO-linked bills with at least one GR)
    const grniRows = await client.query(
      `SELECT id FROM accounts
        WHERE company_id = $1
          AND (name ILIKE '%grni%' OR name ILIKE '%goods received not yet%' OR code ILIKE '%grni%')
          AND is_active = true
        ORDER BY code LIMIT 1`,
      [bill.company_id],
    );
    const grniAccountId = grniRows.rows[0]?.id ?? null;

    // Advances to Supplier account (for PO-linked bills without GR)
    const advRows = await client.query(
      `SELECT id FROM accounts
        WHERE company_id = $1
          AND (name ILIKE '%advance%supplier%' OR name ILIKE '%supplier%advance%'
               OR name ILIKE '%advances to supplier%')
          AND is_active = true
        ORDER BY code LIMIT 1`,
      [bill.company_id],
    );
    const advancesAccountId = advRows.rows[0]?.id ?? null;

    const vatAmount  = Number(bill.vat_amount);
    const subtotal   = Number(bill.subtotal);
    const total      = Number(bill.total);
    const ewtAmount  = Number(bill.ewt_amount ?? 0);
    const netPayable = parseFloat((total - ewtAmount).toFixed(2));

    // EWT Payable account — from the linked tax code's account_id, or fallback search
    let ewtPayableAccountId = (bill.ewt_account_id as string | null) ?? null;
    if (!ewtPayableAccountId && ewtAmount > 0) {
      const ewtAcctRows = await client.query(
        `SELECT id FROM accounts
          WHERE company_id = $1
            AND (name ILIKE '%ewt payable%' OR name ILIKE '%withholding tax payable%' OR name ILIKE '%withholding payable%')
            AND is_active = true
          ORDER BY code LIMIT 1`,
        [bill.company_id],
      );
      ewtPayableAccountId = ewtAcctRows.rows[0]?.id ?? null;
    }

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

    if (bill.po_id) {
      // Check whether this PO has any goods receipts
      const grCountRows = await client.query(
        `SELECT COUNT(*)::int AS c FROM goods_receipts WHERE po_id = $1`,
        [bill.po_id],
      );
      const poHasGR = Number((grCountRows.rows[0] as Record<string, unknown>).c) > 0;

      if (poHasGR && grniAccountId) {
        // PO has GR: DR GRNI (clear the receipt accrual)
        await client.query(
          `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
           VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
          [je.id, lineNo++, grniAccountId, `Clear GRNI — ${bill.internal_no}`, subtotal],
        );
      } else {
        // PO has no GR: DR Advances to Suppliers
        if (!advancesAccountId) {
          await client.query('ROLLBACK');
          return err('No "Advances to Suppliers" account found. Please run migrations or add the account to your Chart of Accounts.', 400);
        }
        await client.query(
          `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
           VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
          [je.id, lineNo++, advancesAccountId, `Advance to Supplier — ${bill.internal_no}`, subtotal],
        );
      }
    } else {
      // Non-PO bill: DR Expense per line
      for (const l of lineRows.rows as Array<Record<string, unknown>>) {
        const acctId = (l.eff_expense_acct as string | null) ?? defaultExpAcctId;
        if (!acctId) continue;
        await client.query(
          `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
           VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
          [je.id, lineNo++, acctId, l.description, Number(l.line_subtotal)],
        );
      }
    }

    // DR Input VAT
    if (vatAmount > 0 && vatAccountId) {
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
        [je.id, lineNo++, vatAccountId, `Input VAT — ${bill.internal_no}`, vatAmount],
      );
    }

    // CR EWT Payable (withheld from supplier payment; to be remitted to BIR)
    if (ewtAmount > 0 && ewtPayableAccountId) {
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
        [je.id, lineNo++, ewtPayableAccountId,
          `EWT Payable${bill.ewt_code ? ` (${bill.ewt_code})` : ''} — ${bill.internal_no}`,
          ewtAmount],
      );
    }

    // CR Accounts Payable — net payable (gross total less EWT withheld)
    await client.query(
      `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
       VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
      [je.id, lineNo++, apAccountId, `AP — ${bill.internal_no}`, netPayable],
    );

    // Update account balances
    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
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

    // Auto-create BIR Form 2307 certificate if EWT was withheld
    const ewtAmt = Number(bill.ewt_amount ?? 0);
    if (ewtAmt > 0) {
      const existingCert = await client.query(
        `SELECT id FROM wht_certificates WHERE bill_id = $1 LIMIT 1`,
        [params.id],
      );
      if (!existingCert.rows[0]) {
        const billDate = new Date(bill.bill_date as string);
        const periodYear = billDate.getFullYear();
        const periodQuarter = Math.ceil((billDate.getMonth() + 1) / 3);
        const ewtRate = Number(bill.ewt_code_rate ?? bill.supplier_ewt_rate ?? 1);
        const atcCode = (bill.supplier_atc_code as string | null) ?? 'WC158';

        const certSeqRows = await client.query(
          `SELECT COUNT(*)::int AS c FROM wht_certificates WHERE company_id = $1`,
          [bill.company_id],
        );
        const certNo = `2307-${periodYear}-Q${periodQuarter}-${String(certSeqRows.rows[0].c + 1).padStart(5, '0')}`;

        await client.query(
          `INSERT INTO wht_certificates
             (company_id, cert_no, bill_id, supplier_id, bir_atc_code,
              taxable_amount, rate_pct, amount_withheld, period_year, period_quarter, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11)`,
          [
            bill.company_id, certNo, params.id, bill.supplier_id, atcCode,
            Number(bill.subtotal).toFixed(2), ewtRate.toFixed(4), ewtAmt.toFixed(2),
            periodYear, periodQuarter, auth.userId,
          ],
        );
      }
    }

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
