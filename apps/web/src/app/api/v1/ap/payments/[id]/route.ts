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
    `SELECT sp.*, s.name AS supplier_name, s.code AS supplier_code,
            s.address AS supplier_address, s.payment_terms_days AS supplier_terms
       FROM supplier_payments sp
       JOIN suppliers s ON s.id = sp.supplier_id
      WHERE sp.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Payment ${params.id} not found`, 404);

  const applications = await query(
    `SELECT bpa.*, b.internal_no, b.bill_no, b.bill_date
       FROM bill_payment_applications bpa
       JOIN bills b ON b.id = bpa.bill_id
      WHERE bpa.payment_id = $1`,
    [params.id],
  );

  return ok({
    ...rows[0],
    amount: Number((rows[0] as Record<string, unknown>).amount),
    applications: applications.map((a) => ({
      ...a,
      amount_applied: Number((a as Record<string, unknown>).amount_applied),
    })),
  });
}
