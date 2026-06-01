export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'reset-as-jbd-2026';

// Truncates all transactions and master data EXCEPT accounts (COA) and cost_centers.
// Listed in dependency order so FK constraints are satisfied.
const TABLES = [
  // Poultry operations (deepest first)
  'poultry_invoice_lines',
  'poultry_invoices',
  'poultry_delivery_lines',
  'poultry_deliveries',
  'sales_tally_lines',
  'sales_tally_sheets',
  'tally_sheet_lines',
  'tally_sheets',
  'conversion_outputs',
  'conversions',
  'grow_weekly_weights',
  'grow_item_consumption',
  'grow_daily_mortality',
  'grow_mortality_logs',
  'poultry_inventory_ledger',
  'poultry_inventory_balance',
  'grow_cycles',
  'chick_batches',
  'inventory_in_lines',
  'inventory_ins',
  'order_in_lines',
  'order_ins',
  'grow_references',
  'farm_buildings',
  // Financials
  'wht_certificates',
  'sc_pwd_transactions',
  'vat_relief_entries',
  'payment_applications',
  'bill_payment_applications',
  'ar_credit_memo_applications',
  'ar_credit_memo_lines',
  'ar_credit_memos',
  'inventory_reservations',
  'delivery_receipt_lines',
  'delivery_receipts',
  'sales_invoice_lines',
  'sales_invoices',
  'sales_order_lines',
  'sales_orders',
  'customer_payments',
  'supplier_payments',
  'bill_lines',
  'bills',
  'recurring_entries',
  'journal_entry_lines',
  'journal_entries',
  'issued_document_lines',
  'issued_documents',
  'bir_filings',
  'book_generations',
  'filing_validations',
  'excise_pass_through',
  'account_balances',
  'audit_log',
  // Stock / inventory
  'stock_count_lines',
  'stock_counts',
  'stock_transfer_lines',
  'stock_transfers',
  'stock_adjustment_lines',
  'stock_adjustments',
  'stock_movements',
  'stock_balances',
  // Fuel module
  'fuel_deliveries',
  'fuel_reconciliations',
  'pump_readings',
  'tank_readings',
  'retail_shifts',
  'pumps',
  'fuel_tanks',
  // Master data (keep accounts + cost_centers)
  'uom_conversions',
  'uoms',
  'items',
  'item_categories',
  'warehouses',
  'payment_methods',
  'customers',
  'suppliers',
  'departments',
];

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];

  for (const table of TABLES) {
    try {
      await query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
      results.push(`${table}: ok`);
    } catch (e: unknown) {
      const msg = (e as Error).message;
      // "does not exist" is fine — table just isn't in this schema version
      if (msg.includes('does not exist')) {
        results.push(`${table}: skipped (not found)`);
      } else {
        results.push(`${table}: ${msg}`);
      }
    }
  }

  // Reset document series counters
  try {
    await query(`UPDATE document_series SET current_number = 0`);
    results.push('document_series: counters reset');
  } catch (e) {
    results.push(`document_series: ${(e as Error).message}`);
  }

  return ok({ results });
}
