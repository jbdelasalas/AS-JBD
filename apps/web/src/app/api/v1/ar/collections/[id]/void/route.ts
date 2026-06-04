export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

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

  let reason = '';
  try {
    const body = await request.json();
    reason = body.reason ?? '';
  } catch {
    // optional
  }
  if (!reason?.trim()) return err('Void reason required', 400);

  const id = params.id;
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const rows = await client.query(`SELECT * FROM customer_payments WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.rows[0]) { await client.query('ROLLBACK'); return err(`Payment ${id} not found`, 404); }
    const pmt = rows.rows[0] as Record<string, unknown>;

    if (['cancelled', 'draft'].includes(pmt.status as string)) {
      await client.query('ROLLBACK');
      return err(`Cannot void payment in status: ${pmt.status}`, 400);
    }

    // Reverse invoice applications
    const apps = await client.query(
      `SELECT pa.invoice_id, pa.amount_applied FROM payment_applications WHERE payment_id = $1`,
      [id],
    );
    for (const app of apps.rows as Array<{ invoice_id: string; amount_applied: string }>) {
      const applied = Number(app.amount_applied);
      const invRows = await client.query(
        `SELECT balance, total, amount_paid FROM sales_invoices WHERE id = $1 FOR UPDATE`,
        [app.invoice_id],
      );
      if (!invRows.rows[0]) continue;

      const newBalance = Number(invRows.rows[0].balance) + applied;
      const newAmtPaid = Math.max(Number(invRows.rows[0].amount_paid) - applied, 0);
      const newStatus = newAmtPaid <= 0 ? 'open' : 'partially_paid';

      await client.query(
        `UPDATE sales_invoices SET balance = $2, amount_paid = $3, status = $4 WHERE id = $1`,
        [app.invoice_id, newBalance.toFixed(2), newAmtPaid.toFixed(2), newStatus],
      );
    }

    // Reverse GL
    if (pmt.je_id) {
      const jeRows = await client.query(`SELECT * FROM journal_entries WHERE id = $1`, [pmt.je_id]);
      if (jeRows.rows[0]?.status === 'posted') {
        await client.query(
          `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
           SELECT jel.account_id, $2, SUM(-jel.debit), SUM(-jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
           ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET debit_total = account_balances.debit_total + EXCLUDED.debit_total, credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
          [pmt.je_id, jeRows.rows[0].fiscal_period_id],
        );
        await client.query(
          `UPDATE journal_entries SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`,
          [pmt.je_id, auth.userId, reason],
        );
      }
    }

    await client.query(
      `UPDATE customer_payments SET status = 'cancelled', voided_by = $2, voided_at = now(), void_reason = $3 WHERE id = $1`,
      [id, auth.userId, reason],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state) VALUES ($1, $2, $3, $4, $5, $6)`,
      [auth.userId, pmt.company_id, 'void', 'customer_payment', id, JSON.stringify({ reason })],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const fullHeaders = await query(
    `SELECT cp.*, c.name AS customer_name, c.code AS customer_code FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id WHERE cp.id = $1 LIMIT 1`,
    [id],
  );
  const applications = await query(
    `SELECT pa.*, si.invoice_no FROM payment_applications pa JOIN sales_invoices si ON si.id = pa.invoice_id WHERE pa.payment_id = $1`,
    [id],
  );

  const h = fullHeaders[0] as Record<string, unknown>;
  return ok({
    ...h,
    amount: Number(h.amount),
    unapplied_amount: Number(h.unapplied_amount ?? 0),
    applications: applications.map((a) => ({ ...a, amount_applied: Number((a as Record<string, unknown>).amount_applied) })),
  });
}
