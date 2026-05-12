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

    if (so.status !== 'draft') { await client.query('ROLLBACK'); return err(`Cannot submit: order is ${so.status}`, 400); }

    const creditRows = await client.query(
      `SELECT c.credit_limit, COALESCE(SUM(si.balance), 0) AS open_ar FROM customers c LEFT JOIN sales_invoices si ON si.customer_id = c.id AND si.status IN ('open','partially_paid','overdue') WHERE c.id = $1 GROUP BY c.id`,
      [so.customer_id],
    );
    const creditLimit = Number(creditRows.rows[0]?.credit_limit ?? 0);
    const openAr = Number(creditRows.rows[0]?.open_ar ?? 0);
    const creditOk = creditLimit === 0 || (openAr + Number(so.total)) <= creditLimit;

    await client.query(
      `UPDATE sales_orders SET status = 'pending_approval', credit_checked = $2 WHERE id = $1`,
      [id, creditOk],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, so.company_id, 'submit_approval', 'sales_order', id],
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
