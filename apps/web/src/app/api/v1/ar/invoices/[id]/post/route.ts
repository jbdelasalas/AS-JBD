export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { type PoolClient } from 'pg';
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

  const id = params.id;
  let client: PoolClient;
  try {
    client = await getPool().connect();
  } catch (e) {
    return err((e as Error).message ?? 'Database connection failed', 500);
  }
  try {
    await client.query('BEGIN');

    const rows = await client.query(
      `SELECT si.*, c.ar_account_id, c.name AS customer_name
         FROM sales_invoices si
         JOIN customers c ON c.id = si.customer_id
        WHERE si.id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows.rows[0]) { await client.query('ROLLBACK'); return err(`Invoice ${id} not found`, 404); }
    const inv = rows.rows[0] as Record<string, unknown>;

    if (inv.status === 'open') { await client.query('ROLLBACK'); return err('Invoice is already posted', 409); }
    if (inv.status === 'cancelled') { await client.query('ROLLBACK'); return err('Invoice is cancelled', 400); }
    if (inv.status !== 'draft') { await client.query('ROLLBACK'); return err(`Invoice is ${inv.status}`, 400); }

    // Inventory check (only for direct SIs not linked to a DR — DR post already decremented stock)
    if (!inv.dr_id) {
      const companyRows = await client.query(
        `SELECT allow_negative_inventory FROM companies WHERE id = $1`, [inv.company_id],
      );
      const allowNegative = companyRows.rows[0]?.allow_negative_inventory ?? false;

      if (!allowNegative) {
        const itemLines = await client.query(
          `SELECT sil.item_id, sil.quantity, i.name AS item_name,
                  COALESCE(SUM(sb.qty_on_hand), 0) AS qty_on_hand
             FROM sales_invoice_lines sil
             JOIN items i ON i.id = sil.item_id
             LEFT JOIN stock_balances sb ON sb.item_id = sil.item_id
            WHERE sil.invoice_id = $1 AND sil.item_id IS NOT NULL
            GROUP BY sil.item_id, sil.quantity, i.name`,
          [id],
        );
        for (const line of itemLines.rows as Array<Record<string, unknown>>) {
          const qty = Number(line.quantity);
          const available = Number(line.qty_on_hand ?? 0);
          if (available - qty < -0.0001) {
            await client.query('ROLLBACK');
            return err(
              `Insufficient stock for "${line.item_name}": available ${available}, needed ${qty}. ` +
              `Enable "Allow Negative Inventory" in Administration to permit selling without stock.`,
              400,
            );
          }
        }
      }
    }

    // Fiscal period
    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [inv.company_id, inv.invoice_date],
    );
    if (!periodRows.rows[0]) { await client.query('ROLLBACK'); return err(`No fiscal period for ${inv.invoice_date}`, 400); }
    const period = periodRows.rows[0];
    if (period.status === 'closed') { await client.query('ROLLBACK'); return err('Fiscal period is closed', 400); }

    // AR account
    let arAccountId = inv.ar_account_id;
    if (!arAccountId) {
      const ctrlRows = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'ASSET' AND is_active = true ORDER BY code ASC LIMIT 1`,
        [inv.company_id],
      );
      arAccountId = ctrlRows.rows[0]?.id;
      if (!arAccountId) { await client.query('ROLLBACK'); return err('No AR control account configured', 400); }
    }

    // VAT account
    const vatAccountRows = await client.query(
      `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'LIABILITY' AND (code LIKE '%VAT%' OR name ILIKE '%output%vat%') AND is_active = true ORDER BY code ASC LIMIT 1`,
      [inv.company_id],
    );
    const vatAccountId = vatAccountRows.rows[0]?.id;

    const invoiceLines = await client.query(
      `SELECT sil.*, i.revenue_account_id AS item_revenue_acct FROM sales_invoice_lines sil LEFT JOIN items i ON i.id = sil.item_id WHERE sil.invoice_id = $1`,
      [id],
    );

    const total = Number(inv.total);
    const vatAmount = Number(inv.vat_amount);
    const subtotal = Number(inv.subtotal);

    // Get next JE doc number
    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now() WHERE company_id = $1 AND doc_type = $2 AND is_active = true RETURNING prefix, current_number`,
      [inv.company_id, 'journal_voucher'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for journal_voucher', 400); }
    const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const jeRows = await client.query(
      `INSERT INTO journal_entries (company_id, branch_id, entry_no, entry_date, fiscal_period_id, reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ar','sales_invoice',$8,'posted',$9) RETURNING *`,
      [
        inv.company_id, inv.branch_id ?? null, jeNo, inv.invoice_date, period.id,
        inv.invoice_no, `SI ${inv.invoice_no} — ${inv.customer_name ?? ''}`, id, auth.userId,
      ],
    );
    const je = jeRows.rows[0];

    let lineNo = 1;
    // DR AR
    await client.query(
      `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
      [je.id, lineNo++, arAccountId, `AR — ${inv.invoice_no}`, total],
    );

    // CR Revenue per line
    for (const l of invoiceLines.rows as Array<Record<string, unknown>>) {
      const revenueAcct = l.revenue_account_id ?? l.item_revenue_acct;
      if (!revenueAcct) continue;
      const lineSubtotal = Number(l.line_subtotal);
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
        [je.id, lineNo++, revenueAcct, l.description, lineSubtotal],
      );
    }

    // CR Output VAT
    if (vatAmount > 0 && vatAccountId) {
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
        [je.id, lineNo++, vatAccountId, `Output VAT — ${inv.invoice_no}`, vatAmount],
      );
    }

    // Catch-all revenue if lines don't account for full subtotal
    const lineRevTotal = (invoiceLines.rows as Array<Record<string, unknown>>)
      .filter((l) => l.revenue_account_id ?? l.item_revenue_acct)
      .reduce((s, l) => s + Number(l.line_subtotal), 0);

    if (Math.abs(lineRevTotal - subtotal) > 0.01) {
      const defaultRevRows = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'REVENUE' AND is_active = true ORDER BY code ASC LIMIT 1`,
        [inv.company_id],
      );
      if (defaultRevRows.rows[0]) {
        const diff = subtotal - lineRevTotal;
        await client.query(
          `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit) VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
          [je.id, lineNo++, defaultRevRows.rows[0].id, `Revenue — ${inv.invoice_no}`, diff],
        );
      }
    }

    // Update account balances
    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
       ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET debit_total = account_balances.debit_total + EXCLUDED.debit_total, credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
      [je.id, period.id],
    );

    await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [je.id, auth.userId]);
    await client.query(`UPDATE sales_invoices SET status = 'open', je_id = $2, posted_at = now() WHERE id = $1`, [id, je.id]);

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, inv.company_id, 'post', 'sales_invoice', id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Internal server error', 500);
  } finally {
    client.release();
  }

  try {
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
  } catch (e) {
    return err((e as Error).message ?? 'Internal server error', 500);
  }
}
