export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { resolvePortalCustomer, PORTAL_TERMINAL } from '@/lib/portal-helpers';

// GET /portal/orders?scope=ongoing|confirmed
// Lists the logged-in customer's portal orders, newest first.
export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const res = await resolvePortalCustomer(auth);
  if ('response' in res) return res.response;
  const { customer } = res;

  const scope = new URL(request.url).searchParams.get('scope') ?? 'ongoing';

  // ongoing  = portal_status NOT in terminal stages
  // confirmed = portal_status IN terminal stages (Delivered/Cancelled/Rejected)
  const terminalList = PORTAL_TERMINAL.map((_, i) => `$${i + 3}`).join(', ');
  const scopeClause =
    scope === 'confirmed'
      ? `AND o.portal_status IN (${terminalList})`
      : `AND (o.portal_status IS NULL OR o.portal_status NOT IN (${terminalList}))`;

  const params: unknown[] = [customer.company_id, customer.id, ...PORTAL_TERMINAL];

  const orders = await query<Record<string, unknown>>(
    `SELECT o.id, o.order_no, o.order_date, o.delivery_date, o.reference,
            o.total, o.priority, o.portal_status, o.truck_no, o.driver,
            o.dr_number, o.delivered_at, o.notes, o.created_at
       FROM sales_orders o
      WHERE o.company_id = $1
        AND o.customer_id = $2
        AND o.is_portal_order = true
        ${scopeClause}
      ORDER BY o.created_at DESC`,
    params,
  );

  // Attach line items for each order
  const ids = orders.map((o) => o.id as string);
  let linesByOrder: Record<string, unknown[]> = {};
  if (ids.length) {
    const lines = await query<Record<string, unknown>>(
      `SELECT l.order_id, l.line_no, l.item_id, l.description,
              l.quantity, l.unit_price, l.line_total, i.uom
         FROM sales_order_lines l
         JOIN items i ON i.id = l.item_id
        WHERE l.order_id = ANY($1::uuid[])
        ORDER BY l.line_no ASC`,
      [ids],
    );
    linesByOrder = lines.reduce<Record<string, unknown[]>>((acc, l) => {
      const k = l.order_id as string;
      (acc[k] ??= []).push({
        line_no: l.line_no,
        item_id: l.item_id,
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        line_total: Number(l.line_total),
        uom: l.uom,
      });
      return acc;
    }, {} as Record<string, unknown[]>);
  }

  return ok({
    data: orders.map((o) => ({
      ...o,
      total: Number(o.total),
      portal_status: o.portal_status ?? 'Pending',
      lines: linesByOrder[o.id as string] ?? [],
    })),
  });
}

// POST /portal/orders — customer places a new order. Starts as 'Pending'.
export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const res = await resolvePortalCustomer(auth);
  if ('response' in res) return res.response;
  const { customer } = res;

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const lines = (dto.lines as Record<string, unknown>[]) ?? [];
  if (!lines.length) return err('At least one order line is required', 400);

  const orderDate = (dto.order_date as string) || new Date().toISOString().slice(0, 10);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Issue next SO number atomically from document_series
    const ser = await client.query(
      `UPDATE document_series
          SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = 'sales_order' AND is_active = true
        RETURNING prefix, current_number`,
      [customer.company_id],
    );
    if (!ser.rows[0]) {
      await client.query('ROLLBACK');
      return err('No active document series for sales_order', 400);
    }
    const orderNo = `${ser.rows[0].prefix}${String(ser.rows[0].current_number).padStart(4, '0')}`;

    // Re-price every line against the customer's contracted price (never trust client prices)
    let subtotal = 0;
    const priced: { item_id: string; description: string; quantity: number; unit_price: number; line_total: number }[] = [];
    for (const l of lines) {
      const itemId = l.item_id as string;
      const qty = Number(l.quantity ?? 0);
      if (!itemId || qty <= 0) continue;
      const pr = await client.query(
        `SELECT i.name, COALESCE(cpl.custom_price, i.selling_price) AS price
           FROM items i
           LEFT JOIN customer_price_list cpl ON cpl.item_id = i.id AND cpl.customer_id = $2
          WHERE i.id = $1 AND i.company_id = $3`,
        [itemId, customer.id, customer.company_id],
      );
      if (!pr.rows[0]) continue;
      const unitPrice = Number(pr.rows[0].price);
      const lineTotal = +(unitPrice * qty).toFixed(2);
      subtotal += lineTotal;
      priced.push({ item_id: itemId, description: pr.rows[0].name, quantity: qty, unit_price: unitPrice, line_total: lineTotal });
    }
    if (!priced.length) { await client.query('ROLLBACK'); return err('No valid order lines', 400); }

    const total = +subtotal.toFixed(2);

    const { rows: [hdr] } = await client.query(
      `INSERT INTO sales_orders
         (company_id, order_no, customer_id, order_date, delivery_date, reference,
          subtotal, vat_amount, total, status, portal_status, is_portal_order,
          priority, notes, created_by, payment_terms_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,'pending_approval','Pending',true,$9,$10,$11,$12)
       RETURNING id, order_no, portal_status, total, order_date, delivery_date`,
      [
        customer.company_id, orderNo, customer.id, orderDate,
        dto.delivery_date ?? null, dto.po_reference ?? dto.reference ?? null,
        total, total, (dto.priority as string) ?? 'Standard',
        dto.notes ?? null, auth.userId, customer.payment_terms_days,
      ],
    );

    for (let i = 0; i < priced.length; i++) {
      const p = priced[i];
      await client.query(
        `INSERT INTO sales_order_lines
           (order_id, line_no, item_id, description, quantity, unit_price, vat_rate, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7)`,
        [hdr.id, i + 1, p.item_id, p.description, p.quantity, p.unit_price, p.line_total],
      );
    }

    await client.query('COMMIT');

    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
       VALUES ($1,$2,'create','portal_order',$3,$4)`,
      [auth.userId, customer.company_id, hdr.id, JSON.stringify({ ...hdr, customer_id: customer.id })],
    ).catch(() => {});

    return ok({ ...hdr, total: Number(hdr.total) }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
