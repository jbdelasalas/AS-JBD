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

  let notes: string | null = null;
  try {
    const body = await request.json();
    notes = body.notes ?? null;
  } catch {
    // optional
  }

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

    if (so.status !== 'pending_approval') { await client.query('ROLLBACK'); return err(`Cannot approve: order is ${so.status}`, 400); }

    await client.query(
      `UPDATE sales_orders SET status = 'approved', approved_by = $2, approved_at = now(), approval_notes = $3 WHERE id = $1`,
      [id, auth.userId, notes],
    );

    // Reserve inventory
    const lines = await client.query(
      `SELECT sol.id, sol.item_id, sol.quantity, sol.qty_delivered, so.warehouse_id FROM sales_order_lines sol JOIN sales_orders so ON so.id = sol.order_id WHERE sol.order_id = $1`,
      [id],
    );

    if (so.warehouse_id) {
      for (const line of lines.rows as Array<Record<string, unknown>>) {
        const qty = Number(line.quantity) - Number(line.qty_delivered);
        if (qty <= 0) continue;

        await client.query(
          `INSERT INTO inventory_reservations (so_id, so_line_id, item_id, warehouse_id, qty_reserved) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (so_line_id) DO UPDATE SET qty_reserved = $5, status = 'active'`,
          [id, line.id, line.item_id, so.warehouse_id, qty],
        );
        await client.query(`UPDATE sales_order_lines SET qty_reserved = $2 WHERE id = $1`, [line.id, qty]);
      }
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, so.company_id, 'approve', 'sales_order', id],
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
