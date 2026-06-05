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

  const id = params.id;
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const rows = await client.query(
      `SELECT dr.*, so.company_id FROM delivery_receipts dr JOIN sales_orders so ON so.id = dr.so_id WHERE dr.id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows.rows[0]) { await client.query('ROLLBACK'); return err(`DR ${id} not found`, 404); }
    const dr = rows.rows[0] as Record<string, unknown>;

    if (dr.status !== 'draft') { await client.query('ROLLBACK'); return err(`DR is already ${dr.status}`, 409); }

    const companyRows = await client.query(
      `SELECT allow_negative_inventory FROM companies WHERE id = $1`, [dr.company_id],
    );
    const allowNegative = companyRows.rows[0]?.allow_negative_inventory ?? false;

    const lines = await client.query(
      `SELECT drl.item_id, drl.qty_delivered, drl.unit_cost, drl.so_line_id, i.name AS item_name,
              COALESCE(sb.qty_on_hand, 0) AS qty_on_hand
         FROM delivery_receipt_lines drl
         JOIN items i ON i.id = drl.item_id
         LEFT JOIN stock_balances sb ON sb.item_id = drl.item_id AND sb.warehouse_id = $2
        WHERE drl.dr_id = $1`,
      [id, dr.warehouse_id],
    );

    if (!allowNegative) {
      for (const line of lines.rows as Array<Record<string, unknown>>) {
        const qty = Number(line.qty_delivered);
        const available = Number(line.qty_on_hand ?? 0);
        if (available - qty < -0.0001) {
          await client.query('ROLLBACK');
          return err(`Insufficient stock for "${line.item_name}": available ${available}, requested ${qty}. Enable "Allow Negative Inventory" in Administration to permit this.`, 400);
        }
      }
    }

    for (const line of lines.rows as Array<Record<string, unknown>>) {
      const qty = Number(line.qty_delivered);
      const cost = Number(line.unit_cost);

      // Decrement stock
      await client.query(
        `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost) VALUES ($1,$2,$3,$4) ON CONFLICT (item_id, warehouse_id) DO UPDATE SET qty_on_hand = stock_balances.qty_on_hand - $3, last_movement_at = now()`,
        [line.item_id, dr.warehouse_id, qty, cost],
      );

      // Stock movement
      await client.query(
        `INSERT INTO stock_movements (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost, reference_type, reference_id, reference_no, created_by)
         VALUES ($1,$2,$3,'sale',$4,$5,$6,'delivery_receipt',$7,$8,$9)`,
        [dr.company_id, line.item_id, dr.warehouse_id, -qty, cost, -(qty * cost), id, dr.dr_no, auth.userId],
      );

      // Update SO line delivered qty
      if (line.so_line_id) {
        await client.query(
          `UPDATE sales_order_lines SET qty_delivered = qty_delivered + $2, qty_reserved = GREATEST(qty_reserved - $2, 0) WHERE id = $1`,
          [line.so_line_id, qty],
        );
      }

      // Release reservation
      await client.query(
        `UPDATE inventory_reservations SET qty_reserved = GREATEST(qty_reserved - $2, 0) WHERE so_line_id = $1`,
        [line.so_line_id, qty],
      );
    }

    // Update SO delivery status
    const soStatusRows = await client.query(
      `SELECT SUM(quantity) AS total_qty, SUM(qty_delivered) AS delivered_qty FROM sales_order_lines WHERE order_id = $1`,
      [dr.so_id],
    );
    const totalQty = Number(soStatusRows.rows[0].total_qty ?? 0);
    const deliveredQty = Number(soStatusRows.rows[0].delivered_qty ?? 0);
    const newSoStatus = deliveredQty >= totalQty - 0.0001 ? 'fully_delivered' : deliveredQty > 0 ? 'partially_delivered' : 'approved';

    await client.query(`UPDATE sales_orders SET status = $2 WHERE id = $1`, [dr.so_id, newSoStatus]);
    await client.query(`UPDATE delivery_receipts SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [id, auth.userId]);

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, dr.company_id, 'post', 'delivery_receipt', id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const fullHeaders = await query(
    `SELECT dr.*, c.name AS customer_name, so.order_no, w.name AS warehouse_name FROM delivery_receipts dr JOIN customers c ON c.id = dr.customer_id JOIN sales_orders so ON so.id = dr.so_id JOIN warehouses w ON w.id = dr.warehouse_id WHERE dr.id = $1 LIMIT 1`,
    [id],
  );
  const drLines = await query(
    `SELECT drl.*, i.sku AS item_sku, i.name AS item_name FROM delivery_receipt_lines drl JOIN items i ON i.id = drl.item_id WHERE drl.dr_id = $1 ORDER BY drl.line_no`,
    [id],
  );

  return ok({
    ...fullHeaders[0],
    lines: drLines.map((l) => ({
      ...l,
      qty_delivered: Number((l as Record<string, unknown>).qty_delivered),
      unit_cost: Number((l as Record<string, unknown>).unit_cost),
    })),
  });
}
