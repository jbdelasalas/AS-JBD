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

  const { searchParams } = new URL(request.url);
  const newOrderAmount = parseFloat(searchParams.get('amount') ?? '0');

  const rows = await query<{ credit_limit: string; open_ar: string }>(
    `SELECT c.credit_limit,
            COALESCE(SUM(si.balance), 0) AS open_ar
       FROM customers c
       LEFT JOIN sales_invoices si ON si.customer_id = c.id
         AND si.status IN ('open','partially_paid','overdue')
      WHERE c.id = $1
      GROUP BY c.id`,
    [params.id],
  );
  if (!rows[0]) return err(`Customer ${params.id} not found`, 404);

  const limit = Number(rows[0].credit_limit);
  const used = Number(rows[0].open_ar);
  const available = limit - used;

  return ok({
    ok: limit === 0 || (used + newOrderAmount) <= limit,
    available,
    used,
    limit,
  });
}
