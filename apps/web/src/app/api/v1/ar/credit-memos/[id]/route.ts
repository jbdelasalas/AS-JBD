export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return {
    ...r,
    subtotal: Number(r.subtotal),
    vat_amount: Number(r.vat_amount),
    total: Number(r.total),
    amount_applied: Number(r.amount_applied),
    unapplied_amount: Number(r.unapplied_amount),
  };
}

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
    `SELECT cm.*, c.name AS customer_name, si.invoice_no FROM ar_credit_memos cm JOIN customers c ON c.id = cm.customer_id LEFT JOIN sales_invoices si ON si.id = cm.original_invoice_id WHERE cm.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!headers[0]) return err(`Credit memo ${params.id} not found`, 404);

  const lines = await query(
    `SELECT cml.*, i.sku AS item_sku, i.name AS item_name FROM ar_credit_memo_lines cml LEFT JOIN items i ON i.id = cml.item_id WHERE cml.cm_id = $1 ORDER BY cml.line_no`,
    [params.id],
  );

  return ok({ ...mapRow(headers[0] as Record<string, unknown>), lines });
}
