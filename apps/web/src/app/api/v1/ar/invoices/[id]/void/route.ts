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
    amount_paid: Number(r.amount_paid),
    balance: Number(r.balance),
    discount_amount: Number(r.discount_amount ?? 0),
  };
}

function mapLine(l: Record<string, unknown>) {
  return {
    ...l,
    quantity: Number(l.quantity),
    unit_price: Number(l.unit_price),
    discount_pct: Number(l.discount_pct ?? 0),
    vat_rate: Number(l.vat_rate),
    line_subtotal: Number(l.line_subtotal),
    line_vat: Number(l.line_vat),
    line_total: Number(l.line_total),
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

    const rows = await client.query(`SELECT * FROM sales_invoices WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.rows[0]) { await client.query('ROLLBACK'); return err(`Invoice ${id} not found`, 404); }
    const inv = rows.rows[0] as Record<string, unknown>;

    if (['cancelled', 'paid'].includes(inv.status as string)) {
      await client.query('ROLLBACK');
      return err(`Cannot void invoice in status: ${inv.status}`, 400);
    }
    if (Number(inv.amount_paid) > 0) {
      await client.query('ROLLBACK');
      return err('Cannot void partially or fully paid invoice', 400);
    }

    if (inv.je_id) {
      const jeRows = await client.query(`SELECT * FROM journal_entries WHERE id = $1`, [inv.je_id]);
      if (jeRows.rows[0]?.status === 'posted') {
        await client.query(
          `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
           SELECT jel.account_id, $2, -jel.debit, -jel.credit FROM journal_entry_lines jel WHERE jel.entry_id = $1
           ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET debit_total = account_balances.debit_total + EXCLUDED.debit_total, credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
          [inv.je_id, jeRows.rows[0].fiscal_period_id],
        );
        await client.query(
          `UPDATE journal_entries SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`,
          [inv.je_id, auth.userId, reason],
        );
      }
    }

    await client.query(
      `UPDATE sales_invoices SET status = 'cancelled', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`,
      [id, auth.userId, reason],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state) VALUES ($1, $2, $3, $4, $5, $6)`,
      [auth.userId, inv.company_id, 'void', 'sales_invoice', id, JSON.stringify({ reason })],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const fullHeaders = await query(
    `SELECT si.*, c.name AS customer_name, c.code AS customer_code, so.order_no, dr.dr_no
       FROM sales_invoices si JOIN customers c ON c.id = si.customer_id
       LEFT JOIN sales_orders so ON so.id = si.so_id LEFT JOIN delivery_receipts dr ON dr.id = si.dr_id
      WHERE si.id = $1 LIMIT 1`,
    [id],
  );
  const invoiceLines = await query(
    `SELECT sil.*, i.sku AS item_sku, i.name AS item_name FROM sales_invoice_lines sil
       LEFT JOIN items i ON i.id = sil.item_id WHERE sil.invoice_id = $1 ORDER BY sil.line_no`,
    [id],
  );

  return ok({
    ...mapRow(fullHeaders[0] as Record<string, unknown>),
    lines: invoiceLines.map((l) => mapLine(l as Record<string, unknown>)),
  });
}
