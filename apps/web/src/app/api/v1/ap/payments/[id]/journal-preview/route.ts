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
    `SELECT sp.*, s.ap_account_id, s.name AS supplier_name
       FROM supplier_payments sp
       JOIN suppliers s ON s.id = sp.supplier_id
      WHERE sp.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err('Payment not found', 404);
  const pmt = rows[0] as Record<string, unknown>;

  if (!['draft'].includes(String(pmt.status))) {
    return err(`Payment is ${pmt.status} — only draft payments can be posted`, 400);
  }

  const warnings: string[] = [];

  // AP account
  let apAccountId = pmt.ap_account_id as string | null;
  if (!apAccountId) {
    const ctrlRows = await query(
      `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'LIABILITY' AND is_active = true ORDER BY code LIMIT 1`,
      [pmt.company_id],
    );
    apAccountId = (ctrlRows[0] as Record<string, unknown>)?.id as string ?? null;
    if (apAccountId) warnings.push('No AP account on supplier — using default AP control account.');
  }
  if (!apAccountId) return err('No AP control account configured', 400);

  // Bank/Cash account
  let bankAccountId = pmt.bank_account_id as string | null;
  if (!bankAccountId) {
    const bankRows = await query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET' AND (name ILIKE '%cash%' OR name ILIKE '%bank%') AND is_active = true ORDER BY code LIMIT 1`,
      [pmt.company_id],
    );
    bankAccountId = (bankRows[0] as Record<string, unknown>)?.id as string ?? null;
    if (bankAccountId) warnings.push('No bank account on payment — using first cash/bank account.');
  }
  if (!bankAccountId) return err('No bank/cash account configured', 400);

  const acctRows = await query(
    `SELECT id, code, name FROM accounts WHERE id = ANY($1::uuid[])`,
    [[apAccountId, bankAccountId]],
  );
  const acctMap = new Map((acctRows as Array<Record<string, unknown>>).map((a) => [String(a.id), a]));
  const getAcct = (id: string) => {
    const a = acctMap.get(id) as Record<string, unknown> | undefined;
    return { code: String(a?.code ?? '????'), name: String(a?.name ?? 'Unknown') };
  };

  const amount = Number(pmt.amount);
  const ap = getAcct(apAccountId);
  const bank = getAcct(bankAccountId);

  const lines = [
    { account_code: ap.code, account_name: ap.name, description: `AP Payment — ${pmt.voucher_no}`, debit: amount, credit: 0 },
    { account_code: bank.code, account_name: bank.name, description: `CV — ${pmt.voucher_no}`, debit: 0, credit: amount },
  ];

  return ok({
    entry_date: String(pmt.payment_date).split('T')[0],
    reference: String(pmt.voucher_no),
    memo: `CV ${pmt.voucher_no} — ${pmt.supplier_name}`,
    lines,
    total_debit: amount,
    total_credit: amount,
    is_balanced: true,
    warnings,
  });
}
