export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return { ...r, subtotal: Number(r.subtotal), vat_amount: Number(r.vat_amount), total: Number(r.total), discount_pct: Number(r.discount_pct ?? 0) };
}
function mapLine(l: Record<string, unknown>) {
  return { ...l, quantity: Number(l.quantity), qty_delivered: Number(l.qty_delivered), qty_reserved: Number(l.qty_reserved ?? 0), unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct ?? 0), vat_rate: Number(l.vat_rate), line_subtotal: Number(l.line_subtotal ?? 0), line_vat: Number(l.line_vat ?? 0), line_total: Number(l.line_total) };
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
  if (!reason?.trim()) return err('Cancellation reason required', 400);

  const id = params.id;
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const soRows = await client.query(
      `SELECT so.*, c.credit_limit FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = $1 FOR UPDATE`,
      [id],
    );
    if (!soRows.rows[0]) { await client.query('ROLLBACK'); return err(`Sales order ${id} not found`, 404); }
    const so = soRows.rows[0] as Record<string, unknown>;

    if (['fully_delivered', 'closed', 'cancelled'].includes(so.status as string)) {
      await client.query('ROLLBACK');
      return err(`Cannot cancel: order is ${so.status}`, 400);
    }

    await client.query(
      `UPDATE inventory_reservations SET status = 'released', released_at = now() WHERE so_id = $1 AND status = 'active'`,
      [id],
    );

    await client.query(
      `UPDATE sales_orders SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3 WHERE id = $1`,
      [id, auth.userId, reason],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state) VALUES ($1, $2, $3, $4, $5, $6)`,
      [auth.userId, so.company_id, 'cancel', 'sales_order', id, JSON.stringify({ reason })],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const fullHeaders = await query(
    `SELECT so.*, c.name AS customer_name, c.code AS customer_code, c.credit_limit, c.payment_terms_days AS customer_terms FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = $1 LIMIT 1`,
    [id],
  );
  const soLines = await query(
    `SELECT sol.*, i.sku AS item_sku, i.name AS item_name FROM sales_order_lines sol JOIN items i ON i.id = sol.item_id WHERE sol.order_id = $1 ORDER BY sol.line_no`,
    [id],
  );
  return ok({ ...mapRow(fullHeaders[0] as Record<string, unknown>), lines: soLines.map((l) => mapLine(l as Record<string, unknown>)) });
}
