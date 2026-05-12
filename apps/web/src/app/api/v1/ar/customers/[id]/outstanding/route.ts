export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';

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
    `SELECT id, invoice_no, invoice_date, due_date, total, amount_paid, balance, status
       FROM sales_invoices
      WHERE customer_id = $1
        AND status IN ('open','partially_paid','overdue')
      ORDER BY due_date ASC`,
    [params.id],
  );

  return ok(rows);
}
