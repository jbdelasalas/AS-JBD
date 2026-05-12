export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
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

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const applications = dto.applications as Array<{ invoice_id: string; amount_applied: number }>;
  if (!applications?.length) return err('No applications provided', 400);

  const id = params.id;
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const rows = await client.query(`SELECT * FROM ar_credit_memos WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.rows[0]) { await client.query('ROLLBACK'); return err(`Credit memo ${id} not found`, 404); }
    const cm = rows.rows[0] as Record<string, unknown>;

    if (cm.status !== 'approved') {
      await client.query('ROLLBACK');
      return err(`Can only apply approved credit memos (current: ${cm.status})`, 400);
    }

    const totalApplying = applications.reduce((s, a) => s + a.amount_applied, 0);
    const available = Number(cm.unapplied_amount);

    if (totalApplying > available + 0.0001) {
      await client.query('ROLLBACK');
      return err(`Total applying (${totalApplying.toFixed(2)}) exceeds available (${available.toFixed(2)})`, 400);
    }

    for (const app of applications) {
      const invRows = await client.query(
        `SELECT id, balance, status, customer_id FROM sales_invoices WHERE id = $1 FOR UPDATE`,
        [app.invoice_id],
      );
      if (!invRows.rows[0]) { await client.query('ROLLBACK'); return err(`Invoice ${app.invoice_id} not found`, 404); }
      const inv = invRows.rows[0] as Record<string, unknown>;

      if (inv.customer_id !== cm.customer_id) {
        await client.query('ROLLBACK');
        return err(`Invoice ${app.invoice_id} belongs to a different customer`, 400);
      }
      if (!['open', 'partially_paid', 'overdue'].includes(inv.status as string)) {
        await client.query('ROLLBACK');
        return err(`Invoice ${app.invoice_id} is ${inv.status}`, 400);
      }

      const invBalance = Number(inv.balance);
      if (app.amount_applied > invBalance + 0.0001) {
        await client.query('ROLLBACK');
        return err(`Cannot apply ${app.amount_applied} to invoice with balance ${invBalance}`, 400);
      }

      await client.query(
        `INSERT INTO ar_credit_memo_applications (cm_id, invoice_id, amount_applied, applied_by) VALUES ($1,$2,$3,$4) ON CONFLICT (cm_id, invoice_id) DO UPDATE SET amount_applied = $3`,
        [id, app.invoice_id, app.amount_applied, auth.userId],
      );

      const newBalance = invBalance - app.amount_applied;
      const newStatus = newBalance <= 0.001 ? 'paid' : 'partially_paid';
      await client.query(
        `UPDATE sales_invoices SET balance = $2, amount_paid = amount_paid + $3, status = $4 WHERE id = $1`,
        [app.invoice_id, newBalance.toFixed(2), app.amount_applied.toFixed(2), newStatus],
      );
    }

    const newApplied = Number(cm.amount_applied) + totalApplying;
    const newUnapplied = Number(cm.total) - newApplied;
    const newStatus = newUnapplied <= 0.001 ? 'applied' : 'approved';

    await client.query(
      `UPDATE ar_credit_memos SET amount_applied = $2, unapplied_amount = $3, status = $4 WHERE id = $1`,
      [id, newApplied.toFixed(2), Math.max(newUnapplied, 0).toFixed(2), newStatus],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, cm.company_id, 'apply', 'ar_credit_memo', id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const updated = await query(
    `SELECT cm.*, c.name AS customer_name, si.invoice_no FROM ar_credit_memos cm JOIN customers c ON c.id = cm.customer_id LEFT JOIN sales_invoices si ON si.id = cm.original_invoice_id WHERE cm.id = $1 LIMIT 1`,
    [id],
  );
  return ok(mapRow(updated[0] as Record<string, unknown>));
}
