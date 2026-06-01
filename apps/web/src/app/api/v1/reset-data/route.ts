export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'reset-as-jbd-2026';

// Deletes all transactions and master data EXCEPT accounts (COA) and cost_centers.
// Tables are deleted in FK-safe order (children before parents).
export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const client = await getPool().connect();
  const results: string[] = [];

  async function drop(table: string) {
    try {
      await client.query(`DELETE FROM ${table}`);
      results.push(`${table}: cleared`);
    } catch (e) {
      results.push(`${table}: ${(e as Error).message}`);
    }
  }

  try {
    await client.query('BEGIN');

    // ── Poultry operations (deepest first) ──────────────────────────────
    await drop('poultry_invoice_lines');
    await drop('poultry_invoices');
    await drop('poultry_delivery_lines');
    await drop('poultry_deliveries');
    await drop('sales_tally_lines');
    await drop('sales_tally_sheets');
    await drop('tally_sheet_lines');
    await drop('tally_sheets');
    await drop('conversion_outputs');
    await drop('conversions');
    await drop('grow_weekly_weights');
    await drop('grow_item_consumption');
    await drop('grow_daily_mortality');
    await drop('grow_mortality_logs');
    await drop('poultry_inventory_ledger');
    await drop('poultry_inventory_balance');
    await drop('grow_cycles');
    await drop('chick_batches');
    await drop('inventory_in_lines');
    await drop('inventory_ins');
    await drop('order_in_lines');
    await drop('order_ins');
    await drop('grow_references');
    await drop('farm_buildings');

    // ── Financials ───────────────────────────────────────────────────────
    await drop('wht_certificates');
    await drop('sc_pwd_transactions');
    await drop('vat_relief_entries');
    await drop('payment_applications');
    await drop('bill_payment_applications');
    await drop('ar_credit_memo_applications');
    await drop('ar_credit_memo_lines');
    await drop('ar_credit_memos');
    await drop('inventory_reservations');
    await drop('delivery_receipt_lines');
    await drop('delivery_receipts');
    await drop('sales_invoice_lines');
    await drop('sales_invoices');
    await drop('sales_order_lines');
    await drop('sales_orders');
    await drop('customer_payments');
    await drop('supplier_payments');
    await drop('bill_lines');
    await drop('bills');
    await drop('recurring_entries');
    await drop('journal_entry_lines');
    await drop('journal_entries');
    await drop('issued_document_lines');
    await drop('issued_documents');
    await drop('bir_filings');
    await drop('book_generations');
    await drop('filing_validations');
    await drop('excise_pass_through');
    await drop('account_balances');
    await drop('audit_log');

    // ── Stock / inventory ────────────────────────────────────────────────
    await drop('stock_count_lines');
    await drop('stock_counts');
    await drop('stock_transfer_lines');
    await drop('stock_transfers');
    await drop('stock_adjustment_lines');
    await drop('stock_adjustments');
    await drop('stock_movements');
    await drop('stock_balances');

    // ── Fuel module ──────────────────────────────────────────────────────
    await drop('fuel_deliveries');
    await drop('fuel_reconciliations');
    await drop('pump_readings');
    await drop('tank_readings');
    await drop('retail_shifts');
    await drop('pumps');
    await drop('fuel_tanks');

    // ── Master data (keep accounts + cost_centers) ───────────────────────
    await drop('items');
    await drop('item_categories');
    await drop('uom_conversions');
    await drop('uoms');
    await drop('customers');
    await drop('suppliers');
    await drop('warehouses');
    await drop('payment_methods');
    await drop('departments');

    // ── Reset document series counters ───────────────────────────────────
    try {
      await client.query(`UPDATE document_series SET current_number = 0`);
      results.push('document_series: counters reset to 0');
    } catch (e) {
      results.push(`document_series reset: ${(e as Error).message}`);
    }

    await client.query('COMMIT');
    results.push('✓ COMMIT — reset complete');
  } catch (e) {
    await client.query('ROLLBACK');
    results.push(`ROLLBACK: ${(e as Error).message}`);
  } finally {
    client.release();
  }

  return ok({ results });
}
