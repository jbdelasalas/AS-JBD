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

  const rows = await query(
    `SELECT b.*, s.ap_account_id, s.name AS supplier_name
       FROM bills b
       JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.id = $1 LIMIT 1`,
    [params.id],
  );
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

  // Default expense account fallback
  const defExpRows = await query(
    `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'EXPENSE' AND is_active = true ORDER BY code LIMIT 1`,
    [bill.company_id],
  );
  const defaultExpAcctId = (defExpRows[0] as Record<string, unknown>)?.id as string ?? null;

  // Bill lines
  const lineRows = await query(
    `SELECT bl.*, COALESCE(bl.expense_account_id, i.expense_account_id) AS eff_expense_acct
       FROM bill_lines bl
       LEFT JOIN items i ON i.id = bl.item_id
      WHERE bl.bill_id = $1 ORDER BY bl.line_no`,
    [params.id],
  );

  const acctIds = [
    apAccountId,
    vatAccountId,
    defaultExpAcctId,
    ...(lineRows as Array<Record<string, unknown>>).map((l) => l.eff_expense_acct as string | null),
  ].filter(Boolean) as string[];

  const acctRows = await query(`SELECT id, code, name FROM accounts WHERE id = ANY($1::uuid[])`, [acctIds]);
  const acctMap = new Map((acctRows as Array<Record<string, unknown>>).map((a) => [String(a.id), a]));
  const getAcct = (id: string | null) => {
    if (!id) return { code: '????', name: 'Unknown Account' };
    const a = acctMap.get(id) as Record<string, unknown> | undefined;
    return { code: String(a?.code ?? '????'), name: String(a?.name ?? 'Unknown') };
  };

  const vatAmount = Number(bill.vat_amount);
  const total = Number(bill.total);
  const lines = [];

  // DR Expense per line
  for (const l of lineRows as Array<Record<string, unknown>>) {
    const acctId = (l.eff_expense_acct as string | null) ?? defaultExpAcctId;
    if (!acctId) {
      warnings.push(`Line ${l.line_no}: no expense account — line will not be in JE.`);
      continue;
    }
    const acc = getAcct(acctId);
    lines.push({ account_code: acc.code, account_name: acc.name, description: String(l.description), debit: Number(l.line_subtotal), credit: 0 });
  }

  // DR Input VAT
  if (vatAmount > 0 && vatAccountId) {
    const vat = getAcct(vatAccountId);
    lines.push({ account_code: vat.code, account_name: vat.name, description: `Input VAT — ${bill.internal_no}`, debit: vatAmount, credit: 0 });
  } else if (vatAmount > 0) {
    warnings.push('Input VAT account not found — VAT amount will not be captured.');
  }

  // CR Accounts Payable
  const ap = getAcct(apAccountId);
  lines.push({ account_code: ap.code, account_name: ap.name, description: `AP — ${bill.internal_no}`, debit: 0, credit: total });

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
}
