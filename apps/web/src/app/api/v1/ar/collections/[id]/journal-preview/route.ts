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
    `SELECT cp.*, c.ar_account_id, c.name AS customer_name
       FROM customer_payments cp
       JOIN customers c ON c.id = cp.customer_id
      WHERE cp.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err('Payment not found', 404);
  const pmt = rows[0] as Record<string, unknown>;

  if (pmt.status !== 'draft') return err(`Payment is already ${pmt.status}`, 400);

  const warnings: string[] = [];

  // AR account
  let arAccountId = pmt.ar_account_id as string | null;
  if (!arAccountId) {
    const ctrlRows = await query(
      `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'ASSET' AND is_active = true ORDER BY code LIMIT 1`,
      [pmt.company_id],
    );
    arAccountId = (ctrlRows[0] as Record<string, unknown>)?.id as string ?? null;
    if (arAccountId) warnings.push('No AR account on customer — using default AR control account.');
  }
  if (!arAccountId) return err('No AR control account configured', 400);

  // Cash/Bank account
  let cashAccountId = pmt.bank_account_id as string | null;
  if (!cashAccountId) {
    const cashRows = await query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET' AND (name ILIKE '%cash%' OR name ILIKE '%bank%') AND is_active = true ORDER BY code LIMIT 1`,
      [pmt.company_id],
    );
    cashAccountId = (cashRows[0] as Record<string, unknown>)?.id as string ?? null;
    if (cashAccountId) warnings.push('No bank account on payment — using first cash/bank account.');
  }
  if (!cashAccountId) return err('No cash/bank account configured', 400);

  const acctRows = await query(
    `SELECT id, code, name FROM accounts WHERE id = ANY($1::uuid[])`,
    [[arAccountId, cashAccountId]],
  );
  const acctMap = new Map((acctRows as Array<Record<string, unknown>>).map((a) => [String(a.id), a]));
  const getAcct = (id: string) => {
    const a = acctMap.get(id) as Record<string, unknown> | undefined;
    return { code: String(a?.code ?? '????'), name: String(a?.name ?? 'Unknown') };
  };

  const amount = Number(pmt.amount);
  const cash = getAcct(cashAccountId);
  const ar = getAcct(arAccountId);

  const lines = [
    { account_code: cash.code, account_name: cash.name, description: `Receipt — ${pmt.receipt_no}`, debit: amount, credit: 0 },
    { account_code: ar.code, account_name: ar.name, description: `AR payment — ${pmt.receipt_no}`, debit: 0, credit: amount },
  ];

  return ok({
    entry_date: String(pmt.payment_date).split('T')[0],
    reference: String(pmt.receipt_no),
    memo: `OR ${pmt.receipt_no} — ${pmt.customer_name}`,
    lines,
    total_debit: amount,
    total_credit: amount,
    is_balanced: true,
    warnings,
  });
}
