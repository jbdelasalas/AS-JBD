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

    const flagRows = await client.query(
      `SELECT enabled FROM feature_flags WHERE name = 'allow_negative_inventory' LIMIT 1`,
    );
    const allowNegative = flagRows.rows[0]?.enabled ?? false;

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

    // --- GL entry: COGS/Inventory + AR/Revenue ---
    let drJeId: string | null = null;
    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [dr.company_id, dr.delivery_date],
    );
    const period = periodRows.rows[0];
    if (period && period.status !== 'closed') {
      const [cogsAcctRows, invAcctRows, defaultRevRows, vatAcctRows, custRows] = await Promise.all([
        client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'EXPENSE' AND (code = '5010' OR name ILIKE '%cost of goods%') AND is_active = true ORDER BY code ASC LIMIT 1`,
          [dr.company_id],
        ),
        client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET' AND (code = '1200' OR name ILIKE '%inventory%') AND is_active = true ORDER BY code ASC LIMIT 1`,
          [dr.company_id],
        ),
        client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'REVENUE' AND is_active = true ORDER BY code ASC LIMIT 1`,
          [dr.company_id],
        ),
        client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'LIABILITY' AND (code LIKE '%VAT%' OR name ILIKE '%output%vat%') AND is_active = true ORDER BY code ASC LIMIT 1`,
          [dr.company_id],
        ),
        client.query(`SELECT ar_account_id FROM customers WHERE id = $1 LIMIT 1`, [dr.customer_id]),
      ]);

      const defaultCogsId: string | null = cogsAcctRows.rows[0]?.id ?? null;
      const defaultInvId:  string | null = invAcctRows.rows[0]?.id  ?? null;
      const defaultRevId:  string | null = defaultRevRows.rows[0]?.id ?? null;
      const vatAccountId:  string | null = vatAcctRows.rows[0]?.id   ?? null;
      let arAccountId:     string | null = custRows.rows[0]?.ar_account_id ?? null;
      if (!arAccountId) {
        const ctrlRows = await client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'ASSET' AND is_active = true ORDER BY code ASC LIMIT 1`,
          [dr.company_id],
        );
        arAccountId = ctrlRows.rows[0]?.id ?? null;
      }

      const itemAcctRows = await client.query(
        `SELECT drl.item_id, drl.qty_delivered, drl.unit_cost, i.name AS item_name,
                i.cogs_account_id, i.inventory_account_id,
                COALESCE(i.dr_revenue_account_id, i.revenue_account_id) AS revenue_account_id,
                COALESCE(sol.unit_price, 0)   AS unit_price,
                COALESCE(sol.discount_pct, 0) AS discount_pct,
                COALESCE(sol.vat_rate, 0)     AS vat_rate
           FROM delivery_receipt_lines drl
           JOIN items i ON i.id = drl.item_id
           LEFT JOIN sales_order_lines sol ON sol.id = drl.so_line_id
          WHERE drl.dr_id = $1`,
        [id],
      );

      const jeLines: Array<{ account_id: string; description: string; debit: number; credit: number }> = [];
      let totalARDebit = 0;
      let totalVAT = 0;

      for (const ln of itemAcctRows.rows as Array<Record<string, unknown>>) {
        const qty       = Number(ln.qty_delivered);
        const unitCost  = Number(ln.unit_cost);
        const unitPrice = Number(ln.unit_price ?? 0);
        const discPct   = Number(ln.discount_pct ?? 0);
        const vatRate   = Number(ln.vat_rate ?? 0);

        const netSales   = parseFloat((unitPrice * qty * (1 - discPct / 100)).toFixed(2));
        const vatAmt     = parseFloat((netSales * vatRate / 100).toFixed(2));
        const grossSales = parseFloat((netSales + vatAmt).toFixed(2));
        const totalCost  = parseFloat((unitCost * qty).toFixed(2));

        totalARDebit += grossSales;
        totalVAT     += vatAmt;

        // Dr COGS / Cr Inventory (cost side)
        if (totalCost > 0) {
          const cogsAcct = (ln.cogs_account_id as string | null) ?? defaultCogsId;
          const invAcct  = (ln.inventory_account_id as string | null) ?? defaultInvId;
          if (cogsAcct) jeLines.push({ account_id: cogsAcct, description: `COGS — ${ln.item_name} (${dr.dr_no})`, debit: totalCost, credit: 0 });
          if (invAcct)  jeLines.push({ account_id: invAcct,  description: `Inventory — ${ln.item_name} (${dr.dr_no})`, debit: 0, credit: totalCost });
        }

        // Cr Revenue (sales side, net of VAT, per line)
        if (netSales !== 0) {
          const revAcct = (ln.revenue_account_id as string | null) ?? defaultRevId;
          if (revAcct) jeLines.push({ account_id: revAcct, description: `Sales — ${ln.item_name} (${dr.dr_no})`, debit: 0, credit: netSales });
        }
      }

      totalARDebit = parseFloat(totalARDebit.toFixed(2));
      totalVAT     = parseFloat(totalVAT.toFixed(2));

      // Dr AR (consolidated, gross incl. VAT)
      if (totalARDebit > 0 && arAccountId) {
        jeLines.unshift({ account_id: arAccountId, description: `AR — ${dr.dr_no}`, debit: totalARDebit, credit: 0 });
      }
      // Cr Output VAT
      if (totalVAT > 0 && vatAccountId) {
        jeLines.push({ account_id: vatAccountId, description: `Output VAT — ${dr.dr_no}`, debit: 0, credit: totalVAT });
      }

      if (jeLines.length > 0) {
        const seriesRows = await client.query(
          `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
            WHERE company_id = $1 AND doc_type = 'journal_voucher' AND is_active = true RETURNING prefix, current_number`,
          [dr.company_id],
        );
        if (seriesRows.rows[0]) {
          const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;
          const jeInsert = await client.query(
            `INSERT INTO journal_entries (company_id, branch_id, entry_no, entry_date, fiscal_period_id,
               reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'sales','delivery_receipt',$8,'posted',$9) RETURNING id`,
            [dr.company_id, dr.branch_id ?? null, jeNo, dr.delivery_date, period.id,
             dr.dr_no, `DR ${dr.dr_no} — Delivery`, id, auth.userId],
          );
          drJeId = jeInsert.rows[0].id;
          for (let i = 0; i < jeLines.length; i++) {
            const l = jeLines[i];
            await client.query(
              `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
               VALUES ($1,$2,$3,$4,$5,$6,'PHP',1,$5,$6)`,
              [drJeId, i + 1, l.account_id, l.description, l.debit, l.credit],
            );
          }
          await client.query(
            `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
             SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
             ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET
               debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
               credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
            [drJeId, period.id],
          );
          await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [drJeId, auth.userId]);
        }
      }
    }

    await client.query(
      `UPDATE delivery_receipts SET status = 'posted', posted_at = now(), posted_by = $2, je_id = $3 WHERE id = $1`,
      [id, auth.userId, drJeId],
    );

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
