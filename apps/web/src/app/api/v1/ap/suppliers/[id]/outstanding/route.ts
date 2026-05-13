export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const rows = await query(
    `SELECT id FROM suppliers WHERE id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Supplier ${params.id} not found`, 404);

  const bills = await query(
    `SELECT b.id, b.internal_no, b.bill_no, b.bill_date, b.due_date,
            b.total, b.amount_paid, b.balance, b.status
       FROM bills b
      WHERE b.supplier_id = $1
        AND b.status IN ('approved','partial')
      ORDER BY b.due_date ASC`,
    [params.id],
  );

  const totalBalance = bills.reduce((s, r) => s + Number((r as Record<string, unknown>).balance), 0);

  return ok({
    supplier_id: params.id,
    total_balance: totalBalance,
    bills: bills.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        ...row,
        total: Number(row.total),
        amount_paid: Number(row.amount_paid),
        balance: Number(row.balance),
      };
    }),
  });
}
