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

  const invRows = await query(
    `SELECT si.*, c.ar_account_id, c.name AS customer_name
       FROM sales_invoices si
       JOIN customers c ON c.id = si.customer_id
      WHERE si.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!invRows[0]) return err('Invoice not found', 404);
  const inv = invRows[0] as Record<string, unknown>;

  if (inv.status !== 'draft') {
    return err(`Invoice is ${inv.status} — only draft invoices can be posted`, 400);
  }

  const warnings: string[] = [];

  // AR account
  let arAccountId = inv.ar_account_id as string | null;
  if (!arAccountId) {
    const ctrlRows = await query(
      `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'ASSET' AND is_active = true ORDER BY code LIMIT 1`,
      [inv.company_id],
    );
    arAccountId = (ctrlRows[0] as Record<string, unknown>)?.id as string ?? null;
    if (arAccountId) warnings.push('No AR account on customer — using default AR control account.');
  }
  if (!arAccountId) return err('No AR control account configured', 400);

  // VAT account
  const vatRows = await query(
    `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'LIABILITY' AND (code ILIKE '%vat%' OR name ILIKE '%output%vat%') AND is_active = true ORDER BY code LIMIT 1`,
    [inv.company_id],
  );
  const vatAccountId = (vatRows[0] as Record<string, unknown>)?.id as string ?? null;

  // Invoice lines
  const lineRows = await query(
    `SELECT sil.*, COALESCE(sil.revenue_account_id, i.revenue_account_id) AS eff_revenue_acct
       FROM sales_invoice_lines sil
       LEFT JOIN items i ON i.id = sil.item_id
      WHERE sil.invoice_id = $1 ORDER BY sil.line_no`,
    [params.id],
  );

  // Default revenue account fallback
  let defaultRevAcctId: string | null = null;
  const lineRevTotal = (lineRows as Array<Record<string, unknown>>).filter((l) => l.eff_revenue_acct).reduce((s, l) => s + Number(l.line_subtotal), 0);
  const subtotal = Number(inv.subtotal);
  if (Math.abs(lineRevTotal - subtotal) > 0.01) {
    const defRevRows = await query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'REVENUE' AND is_active = true ORDER BY code LIMIT 1`,
      [inv.company_id],
    );
    defaultRevAcctId = (defRevRows[0] as Record<string, unknown>)?.id as string ?? null;
    if (defaultRevAcctId) warnings.push('Some lines have no revenue account — using default revenue account.');
    else warnings.push('Some lines have no revenue account and no default revenue account is configured.');
  }

  // Fetch all account codes+names needed
  const acctIds = [
    arAccountId,
    vatAccountId,
    defaultRevAcctId,
    ...(lineRows as Array<Record<string, unknown>>).map((l) => l.eff_revenue_acct as string | null),
  ].filter(Boolean) as string[];

  const acctRows = await query(
    `SELECT id, code, name FROM accounts WHERE id = ANY($1::uuid[])`,
    [acctIds],
  );
  const acctMap = new Map((acctRows as Array<Record<string, unknown>>).map((a) => [String(a.id), a]));

  const getAcct = (id: string | null) => {
    if (!id) return { code: '????', name: 'Unknown Account' };
    const a = acctMap.get(id) as Record<string, unknown> | undefined;
    return { code: String(a?.code ?? '????'), name: String(a?.name ?? 'Unknown Account') };
  };

  const total = Number(inv.total);
  const vatAmount = Number(inv.vat_amount);

  const lines = [];

  // DR AR
  const ar = getAcct(arAccountId);
  lines.push({ account_code: ar.code, account_name: ar.name, description: `AR — ${inv.invoice_no}`, debit: total, credit: 0 });

  // CR Revenue per line
  for (const l of lineRows as Array<Record<string, unknown>>) {
    const acctId = (l.eff_revenue_acct as string | null) ?? defaultRevAcctId;
    if (!acctId) continue;
    const acc = getAcct(acctId);
    lines.push({ account_code: acc.code, account_name: acc.name, description: String(l.description), debit: 0, credit: Number(l.line_subtotal) });
  }

  // CR Output VAT
  if (vatAmount > 0 && vatAccountId) {
    const vat = getAcct(vatAccountId);
    lines.push({ account_code: vat.code, account_name: vat.name, description: `Output VAT — ${inv.invoice_no}`, debit: 0, credit: vatAmount });
  } else if (vatAmount > 0) {
    warnings.push('Output VAT account not found — VAT amount will not be captured.');
  }

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  return ok({
    entry_date: String(inv.invoice_date).split('T')[0],
    reference: String(inv.invoice_no),
    memo: `SI ${inv.invoice_no} — ${inv.customer_name}`,
    lines,
    total_debit: totalDebit,
    total_credit: totalCredit,
    is_balanced: Math.abs(totalDebit - totalCredit) < 0.01,
    warnings,
  });
}
