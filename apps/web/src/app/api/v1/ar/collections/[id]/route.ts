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

  const headers = await query(
    `SELECT cp.*, c.name AS customer_name, c.code AS customer_code FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id WHERE cp.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!headers[0]) return err(`Payment ${params.id} not found`, 404);

  const apps = await query(
    `SELECT pa.*, si.invoice_no FROM payment_applications pa JOIN sales_invoices si ON si.id = pa.invoice_id WHERE pa.payment_id = $1`,
    [params.id],
  );

  const h = headers[0] as Record<string, unknown>;
  return ok({
    ...h,
    amount: Number(h.amount),
    unapplied_amount: Number(h.unapplied_amount ?? 0),
    applications: apps.map((a) => ({ ...a, amount_applied: Number((a as Record<string, unknown>).amount_applied) })),
  });
}
