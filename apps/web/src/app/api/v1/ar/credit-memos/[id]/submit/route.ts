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

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const id = params.id;

  const cmRows = await query(
    `SELECT cm.*, c.name AS customer_name FROM ar_credit_memos cm JOIN customers c ON c.id = cm.customer_id WHERE cm.id = $1 LIMIT 1`,
    [id],
  );
  if (!cmRows[0]) return err(`Credit memo ${id} not found`, 404);
  const cm = cmRows[0] as Record<string, unknown>;

  if (cm.status !== 'draft') return err(`Cannot submit: CM is ${cm.status}`, 400);

  await query(`UPDATE ar_credit_memos SET status = 'pending_approval' WHERE id = $1`, [id]);

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
    [auth.userId, cm.company_id, 'submit_approval', 'ar_credit_memo', id],
  ).catch(() => {/* non-fatal */});

  const updated = await query(
    `SELECT cm.*, c.name AS customer_name, si.invoice_no FROM ar_credit_memos cm JOIN customers c ON c.id = cm.customer_id LEFT JOIN sales_invoices si ON si.id = cm.original_invoice_id WHERE cm.id = $1 LIMIT 1`,
    [id],
  );
  return ok(mapRow(updated[0] as Record<string, unknown>));
}
