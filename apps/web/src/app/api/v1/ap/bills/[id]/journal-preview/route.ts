export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  try {
    let rows: unknown[];
    try {
      rows = await query(
        `SELECT b.*, s.ap_account_id, s.name AS supplier_name,
                etc.account_id AS ewt_account_id, etc.code AS ewt_code,
                COALESCE(s.bir_atc_code, etc.bir_atc_code) AS supplier_atc_code
           FROM bills b
           JOIN suppliers s ON s.id = b.supplier_id
           LEFT JOIN tax_codes etc ON etc.id = b.ewt_code_id
          WHERE b.id = $1 LIMIT 1`,
        [params.id],
      );
    } catch {
      rows = await query(
        `SELECT b.*, s.ap_account_id, s.name AS supplier_name
           FROM bills b
           JOIN suppliers s ON s.id = b.supplier_id
          WHERE b.id = $1 LIMIT 1`,
        [params.id],
      );
    }
    if (!rows[0]) return err('Bill not found', 404);
    const bill = rows[0] as Record<string, unknown>;

    if (!['draft', 'pending_approval'].includes(String(bill.status))) {
      return err(`Bill is ${bill.status} — only draft or pending_approval bills can be approved`, 400);
    }

    const warnings: string[] = [];

    // AP account
    let apAccountId = bill.ap_account_id as string | null;
    if (!apAccountId) {
      const ctrlRows = await query(
        `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'LIABILITY' AND is_active = true ORDER BY code LIMIT 1`,
        [bill.company_id],
      );
      apAccountId = (ctrlRows[0] as Record<string, unknown>)?.id as string ?? null;
      if (apAccountId) warnings.push('No AP account on supplier — using default AP control account.');
    }
    if (!apAccountId) return err('No AP control account configured', 400);

    // Input VAT account
    const vatRows = await query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET' AND (code ILIKE '%vat%' OR name ILIKE '%input%vat%') AND is_active = true ORDER BY code LIMIT 1`,
      [bill.company_id],
    );
    const vatAccountId = (vatRows[0] as Record<string, unknown>)?.id as string ?? null;

    const vatAmount  = Number(bill.vat_amount);
    const total      = Number(bill.total);
    const subtotal   = Number(bill.subtotal);
    const ewtAmount  = Number(bill.ewt_amount ?? 0);
    const netPayable = parseFloat((total - ewtAmount).toFixed(2));
    const lines = [];

    // EWT Payable account
    let ewtPayableAccountId = (bill.ewt_account_id as string | null) ?? null;
    if (!ewtPayableAccountId && ewtAmount > 0) {
      const ewtAcctRows = await query(
        `SELECT id FROM accounts
          WHERE company_id = $1
            AND (name ILIKE '%ewt payable%' OR name ILIKE '%withholding tax payable%' OR name ILIKE '%withholding payable%')
            AND is_active = true
          ORDER BY code LIMIT 1`,
        [bill.company_id],
      );
      ewtPayableAccountId = (ewtAcctRows[0] as Record<string, unknown>)?.id as string ?? null;
      if (!ewtPayableAccountId && ewtAmount > 0) warnings.push('EWT Payable account not found — link an account to the EWT tax code or create a "EWT Payable" liability account.');
    }

    if (bill.po_id) {
      // Check whether this PO has any goods receipts
      const grCountRows = await query(
        `SELECT COUNT(*)::int AS c FROM goods_receipts WHERE po_id = $1`,
        [bill.po_id as string],
      );
      const poHasGR = Number((grCountRows[0] as Record<string, unknown>).c) > 0;

      // GRNI account (used when PO has at least one GR)
      const grniRows = await query(
        `SELECT id FROM accounts
          WHERE company_id = $1
            AND (name ILIKE '%grni%' OR name ILIKE '%goods received not yet%' OR code ILIKE '%grni%')
            AND is_active = true
          ORDER BY code LIMIT 1`,
        [bill.company_id],
      );
      const grniAccountId = (grniRows[0] as Record<string, unknown>)?.id as string ?? null;

      // Advances to Suppliers account (used when PO has no GR)
      const advRows = await query(
        `SELECT id FROM accounts
          WHERE company_id = $1
            AND (name ILIKE '%advance%supplier%' OR name ILIKE '%supplier%advance%'
                 OR name ILIKE '%advances to supplier%')
            AND is_active = true
          ORDER BY code LIMIT 1`,
        [bill.company_id],
      );
      const advancesAccountId = (advRows[0] as Record<string, unknown>)?.id as string ?? null;

      // Resolve which debit account to use
      const debitAccountId = poHasGR ? grniAccountId : advancesAccountId;
      const debitDescription = poHasGR
        ? `Clear GRNI — ${bill.internal_no}`
        : `Advance to Supplier — ${bill.internal_no}`;

      if (!debitAccountId) {
        warnings.push(poHasGR
          ? 'No GRNI account found. Create a "Goods Received Not Yet Invoiced" account.'
          : 'No "Advances to Suppliers" account found. Run migrations or add the account to your Chart of Accounts.');
      }

      // Look up all account names needed
      const allIds = [apAccountId, vatAccountId, ewtPayableAccountId, debitAccountId].filter(Boolean) as string[];
      const acctRows = await query(`SELECT id, code, name FROM accounts WHERE id = ANY($1::uuid[])`, [allIds]);
      const acctMap = new Map((acctRows as Array<Record<string, unknown>>).map(a => [String(a.id), a]));
      const getAcct = (id: string | null) => {
        if (!id) return { code: '????', name: 'Unknown Account' };
        const a = acctMap.get(id) as Record<string, unknown> | undefined;
        return { code: String(a?.code ?? '????'), name: String(a?.name ?? 'Unknown') };
      };

      if (debitAccountId) {
        const debitAcct = getAcct(debitAccountId);
        lines.push({ account_code: debitAcct.code, account_name: debitAcct.name, description: debitDescription, debit: subtotal, credit: 0 });
      }

      if (vatAmount > 0 && vatAccountId) {
        const vat = getAcct(vatAccountId);
        lines.push({ account_code: vat.code, account_name: vat.name, description: `Input VAT — ${bill.internal_no}`, debit: vatAmount, credit: 0 });
      } else if (vatAmount > 0) {
        warnings.push('Input VAT account not found — VAT amount will not be captured.');
      }

      if (ewtAmount > 0 && ewtPayableAccountId) {
        const ewt = getAcct(ewtPayableAccountId);
        lines.push({ account_code: ewt.code, account_name: ewt.name,
          description: `EWT Payable${(bill.ewt_code as string | null) ? ` (${bill.ewt_code})` : ''} — ${bill.internal_no}`,
          debit: 0, credit: ewtAmount });
      }

      const ap = getAcct(apAccountId);
      lines.push({ account_code: ap.code, account_name: ap.name, description: `AP — ${bill.internal_no}`, debit: 0, credit: netPayable });
    } else {
      // Non-PO bill: DR expense per line, DR VAT, CR EWT Payable, CR AP (net)
      const lineRows = await query(
        `SELECT bl.*, bl.expense_account_id AS eff_expense_acct FROM bill_lines bl WHERE bl.bill_id = $1 ORDER BY bl.line_no`,
        [params.id],
      );
      const defExpRows = await query(
        `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'EXPENSE' AND is_active = true ORDER BY code LIMIT 1`,
        [bill.company_id],
      );
      const defaultExpAcctId = (defExpRows[0] as Record<string, unknown>)?.id as string ?? null;

      const allIds = [apAccountId, vatAccountId, ewtPayableAccountId, defaultExpAcctId,
        ...(lineRows as Array<Record<string, unknown>>).map(l => l.eff_expense_acct as string | null)].filter(Boolean) as string[];
      const acctRows = await query(`SELECT id, code, name FROM accounts WHERE id = ANY($1::uuid[])`, [allIds]);
      const acctMap = new Map((acctRows as Array<Record<string, unknown>>).map(a => [String(a.id), a]));
      const getAcct = (id: string | null) => {
        if (!id) return { code: '????', name: 'Unknown Account' };
        const a = acctMap.get(id) as Record<string, unknown> | undefined;
        return { code: String(a?.code ?? '????'), name: String(a?.name ?? 'Unknown') };
      };

      for (const l of lineRows as Array<Record<string, unknown>>) {
        const acctId = (l.eff_expense_acct as string | null) ?? defaultExpAcctId;
        if (!acctId) { warnings.push(`Line ${l.line_no}: no expense account — line will not be in JE.`); continue; }
        const acc = getAcct(acctId);
        lines.push({ account_code: acc.code, account_name: acc.name, description: String(l.description), debit: Number(l.line_subtotal), credit: 0 });
      }
      if (vatAmount > 0 && vatAccountId) {
        const vat = getAcct(vatAccountId);
        lines.push({ account_code: vat.code, account_name: vat.name, description: `Input VAT — ${bill.internal_no}`, debit: vatAmount, credit: 0 });
      } else if (vatAmount > 0) {
        warnings.push('Input VAT account not found — VAT amount will not be captured.');
      }
      if (ewtAmount > 0 && ewtPayableAccountId) {
        const ewt = getAcct(ewtPayableAccountId);
        lines.push({ account_code: ewt.code, account_name: ewt.name,
          description: `EWT Payable${bill.ewt_code ? ` (${bill.ewt_code})` : ''} — ${bill.internal_no}`,
          debit: 0, credit: ewtAmount });
      }
      const ap = getAcct(apAccountId);
      lines.push({ account_code: ap.code, account_name: ap.name, description: `AP — ${bill.internal_no}`, debit: 0, credit: netPayable });
    }

    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

    return ok({
      entry_date: String(bill.bill_date).split('T')[0],
      reference: String(bill.internal_no),
      memo: `Bill ${bill.internal_no} — ${bill.supplier_name}`,
      lines,
      total_debit: totalDebit,
      total_credit: totalCredit,
      is_balanced: Math.abs(totalDebit - totalCredit) < 0.01,
      warnings,
    });
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to build journal preview', 500);
  }
}
