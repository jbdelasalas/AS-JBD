export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// DELETE in child-first order to respect FK constraints.
// Each step is wrapped in try/catch so missing tables are skipped gracefully.
const STEPS: string[] = [
  // ── Audit ──────────────────────────────────────────────────────────────
  `DELETE FROM audit_log WHERE company_id = $1`,

  // ── BIR / Compliance ───────────────────────────────────────────────────
  `DELETE FROM sc_pwd_transactions WHERE company_id = $1`,
  `DELETE FROM excise_pass_through    WHERE company_id = $1`,
  `DELETE FROM issued_document_lines  WHERE document_id IN (SELECT id FROM issued_documents WHERE company_id = $1)`,
  `DELETE FROM issued_documents       WHERE company_id = $1`,
  `DELETE FROM book_generations       WHERE company_id = $1`,
  `DELETE FROM filing_validations     WHERE company_id = $1`,
  `DELETE FROM wht_certificates       WHERE company_id = $1`,

  // ── Reports ────────────────────────────────────────────────────────────
  `DELETE FROM report_runs      WHERE company_id = $1`,
  `DELETE FROM report_snapshots WHERE company_id = $1`,

  // ── GL ─────────────────────────────────────────────────────────────────
  `DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id = $1)`,
  `DELETE FROM journal_entries     WHERE company_id = $1`,
  `DELETE FROM account_balances    WHERE fiscal_period_id IN (SELECT id FROM fiscal_periods WHERE company_id = $1)`,

  // ── AR Credit Memos ────────────────────────────────────────────────────
  `DELETE FROM ar_credit_memo_applications WHERE cm_id IN (SELECT id FROM ar_credit_memos WHERE company_id = $1)`,
  `DELETE FROM ar_credit_memo_lines        WHERE credit_memo_id IN (SELECT id FROM ar_credit_memos WHERE company_id = $1)`,
  `DELETE FROM ar_credit_memos             WHERE company_id = $1`,

  // ── Payments ───────────────────────────────────────────────────────────
  `DELETE FROM payment_applications     WHERE payment_id IN (SELECT id FROM customer_payments WHERE company_id = $1)`,
  `DELETE FROM customer_payments        WHERE company_id = $1`,
  `DELETE FROM bill_payment_applications WHERE payment_id IN (SELECT id FROM supplier_payments WHERE company_id = $1)`,
  `DELETE FROM supplier_payments        WHERE company_id = $1`,

  // ── Order Allocations ──────────────────────────────────────────────────
  `DELETE FROM order_allocation_lines WHERE allocation_id IN (SELECT id FROM order_allocations WHERE company_id = $1)`,
  `DELETE FROM order_allocations      WHERE company_id = $1`,

  // ── Employee Expense Reports ───────────────────────────────────────────
  `DELETE FROM expense_report_lines   WHERE er_id IN (SELECT id FROM employee_expense_reports WHERE company_id = $1)`,
  `DELETE FROM employee_expense_reports WHERE company_id = $1`,

  // ── Bills ──────────────────────────────────────────────────────────────
  `DELETE FROM bill_lines WHERE bill_id IN (SELECT id FROM bills WHERE company_id = $1)`,
  `DELETE FROM bills      WHERE company_id = $1`,

  // ── Goods Receipts ─────────────────────────────────────────────────────
  `DELETE FROM goods_receipt_lines WHERE grn_id IN (SELECT id FROM goods_receipts WHERE company_id = $1)`,
  `DELETE FROM goods_receipts      WHERE company_id = $1`,

  // ── Purchase Orders ────────────────────────────────────────────────────
  `DELETE FROM purchase_order_lines WHERE po_id IN (SELECT id FROM purchase_orders WHERE company_id = $1)`,
  `DELETE FROM purchase_orders      WHERE company_id = $1`,

  // ── Sales Invoices ─────────────────────────────────────────────────────
  `DELETE FROM sales_invoice_lines WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE company_id = $1)`,
  `DELETE FROM sales_invoices      WHERE company_id = $1`,

  // ── Delivery Receipts ──────────────────────────────────────────────────
  `DELETE FROM delivery_receipt_lines WHERE dr_id IN (SELECT id FROM delivery_receipts WHERE company_id = $1)`,
  `DELETE FROM delivery_receipts      WHERE company_id = $1`,

  // ── Sales Orders ───────────────────────────────────────────────────────
  `DELETE FROM sales_order_lines WHERE order_id IN (SELECT id FROM sales_orders WHERE company_id = $1)`,
  `DELETE FROM sales_orders      WHERE company_id = $1`,

  // ── Poultry Sales ──────────────────────────────────────────────────────
  `DELETE FROM poultry_invoice_lines  WHERE invoice_id  IN (SELECT id FROM poultry_invoices  WHERE company_id = $1)`,
  `DELETE FROM poultry_invoices       WHERE company_id = $1`,
  `DELETE FROM poultry_delivery_lines WHERE delivery_id IN (SELECT id FROM poultry_deliveries WHERE company_id = $1)`,
  `DELETE FROM poultry_deliveries     WHERE company_id = $1`,
  `DELETE FROM sales_tally_lines      WHERE tally_id IN (SELECT id FROM sales_tally_sheets WHERE company_id = $1)`,
  `DELETE FROM sales_tally_sheets     WHERE company_id = $1`,

  // ── Conversions ────────────────────────────────────────────────────────
  `DELETE FROM conversion_outputs WHERE conversion_id IN (SELECT id FROM conversions WHERE company_id = $1)`,
  `DELETE FROM conversions        WHERE company_id = $1`,

  // ── Tally Sheets ───────────────────────────────────────────────────────
  `DELETE FROM tally_sheet_lines WHERE tally_sheet_id IN (SELECT id FROM tally_sheets WHERE company_id = $1)`,
  `DELETE FROM tally_sheets      WHERE company_id = $1`,

  // ── Grow Cycles ────────────────────────────────────────────────────────
  `DELETE FROM grow_daily_mortality  WHERE grow_cycle_id IN (SELECT id FROM grow_cycles WHERE company_id = $1)`,
  `DELETE FROM grow_weekly_weights   WHERE grow_cycle_id IN (SELECT id FROM grow_cycles WHERE company_id = $1)`,
  `DELETE FROM grow_item_consumption WHERE grow_cycle_id IN (SELECT id FROM grow_cycles WHERE company_id = $1)`,
  `DELETE FROM grow_mortality_logs   WHERE grow_cycle_id IN (SELECT id FROM grow_cycles WHERE company_id = $1)`,
  `DELETE FROM chick_batches         WHERE company_id = $1`,
  `DELETE FROM grow_cycles           WHERE company_id = $1`,

  // ── Inventory Ins ──────────────────────────────────────────────────────
  `DELETE FROM inventory_in_lines WHERE inventory_in_id IN (SELECT id FROM inventory_ins WHERE company_id = $1)`,
  `DELETE FROM inventory_ins      WHERE company_id = $1`,
  `DELETE FROM order_in_lines     WHERE order_in_id IN (SELECT id FROM order_ins WHERE company_id = $1)`,
  `DELETE FROM order_ins          WHERE company_id = $1`,

  // ── Inventory Balances / Ledger ────────────────────────────────────────
  `DELETE FROM stock_adjustment_lines WHERE adj_id IN (SELECT id FROM stock_adjustments WHERE company_id = $1)`,
  `DELETE FROM stock_adjustments      WHERE company_id = $1`,
  `DELETE FROM stock_transfer_lines   WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE company_id = $1)`,
  `DELETE FROM stock_transfers        WHERE company_id = $1`,
  `DELETE FROM stock_count_lines      WHERE count_id IN (SELECT id FROM stock_counts WHERE company_id = $1)`,
  `DELETE FROM stock_counts           WHERE company_id = $1`,
  `DELETE FROM inventory_reservations WHERE company_id = $1`,
  `DELETE FROM stock_balances         WHERE company_id = $1`,
  `DELETE FROM poultry_inventory_ledger  WHERE company_id = $1`,
  `DELETE FROM poultry_inventory_balance WHERE company_id = $1`,
];

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const companyId = body.company_id as string | undefined;
  if (!companyId) return err('company_id is required', 400);

  if (!auth.isSuperadmin) return err('Forbidden — superadmin only', 403);

  const results: { step: string; deleted: number; error?: string }[] = [];
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    for (const sql of STEPS) {
      await client.query('SAVEPOINT wipe_step');
      try {
        const res = await client.query(sql, [companyId]);
        results.push({ step: sql.slice(0, 60), deleted: res.rowCount ?? 0 });
        await client.query('RELEASE SAVEPOINT wipe_step');
      } catch (e: unknown) {
        // Table may not exist in this deployment — skip it
        await client.query('ROLLBACK TO SAVEPOINT wipe_step');
        await client.query('RELEASE SAVEPOINT wipe_step');
        results.push({ step: sql.slice(0, 60), deleted: 0, error: (e as Error).message.split('\n')[0] });
      }
    }

    // Reset all document series counters for this company
    await client.query(`UPDATE document_series SET current_number = 0 WHERE company_id = $1`, [companyId]);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    return err((e as Error).message, 500);
  }
  client.release();

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'wipe_transactions','company',$2)`,
    [auth.userId, companyId],
  ).catch(() => {});

  return ok({ message: 'Transaction data wiped successfully. Master data preserved.', steps: results });
}
