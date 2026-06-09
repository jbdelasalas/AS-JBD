export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Full production → sandbox sync for a company.
// Uses a single connection (search_path = public) with explicit sandbox.table references.
// Each step is wrapped in a savepoint so non-fatal errors (table not found, etc.) don't abort.
export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  if (!auth.isSuperadmin) return err('Superadmin only', 403);

  const { company_id } = await request.json().catch(() => ({ company_id: '' }));
  if (!company_id) return err('company_id required', 400);

  const conn = await getPool(false).connect(); // prod pool, search_path = public
  const results: string[] = [];

  async function step(label: string, sql: string, params: unknown[] = []) {
    await conn.query('SAVEPOINT s');
    try {
      const res = await conn.query(sql, params);
      const n = res.rowCount ?? 0;
      if (n > 0) results.push(`✓ ${label}: ${n}`);
      await conn.query('RELEASE SAVEPOINT s');
    } catch (e: unknown) {
      await conn.query('ROLLBACK TO SAVEPOINT s');
      await conn.query('RELEASE SAVEPOINT s');
      results.push(`⚠ ${label}: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  try {
    await conn.query('BEGIN');

    // ══════════════════════════════════════════════════════════
    // PHASE 1 — Wipe all sandbox data for this company
    // Delete children before parents to respect FK constraints.
    // ══════════════════════════════════════════════════════════

    const wipe = (label: string, sql: string) => step(`wipe ${label}`, sql, [company_id]);

    // Transactional
    await wipe('audit_log',              `DELETE FROM sandbox.audit_log WHERE company_id=$1`);
    await wipe('sc_pwd_transactions',    `DELETE FROM sandbox.sc_pwd_transactions WHERE company_id=$1`);
    await wipe('excise_pass_through',    `DELETE FROM sandbox.excise_pass_through WHERE company_id=$1`);
    await wipe('issued_document_lines',  `DELETE FROM sandbox.issued_document_lines WHERE document_id IN (SELECT id FROM sandbox.issued_documents WHERE company_id=$1)`);
    await wipe('issued_documents',       `DELETE FROM sandbox.issued_documents WHERE company_id=$1`);
    await wipe('book_generations',       `DELETE FROM sandbox.book_generations WHERE company_id=$1`);
    await wipe('filing_validations',     `DELETE FROM sandbox.filing_validations WHERE company_id=$1`);
    await wipe('wht_certificates',       `DELETE FROM sandbox.wht_certificates WHERE company_id=$1`);
    await wipe('report_runs',            `DELETE FROM sandbox.report_runs WHERE company_id=$1`);
    await wipe('report_snapshots',       `DELETE FROM sandbox.report_snapshots WHERE company_id=$1`);
    await wipe('journal_entry_lines',    `DELETE FROM sandbox.journal_entry_lines WHERE entry_id IN (SELECT id FROM sandbox.journal_entries WHERE company_id=$1)`);
    await wipe('journal_entries',        `DELETE FROM sandbox.journal_entries WHERE company_id=$1`);
    await wipe('account_balances',       `DELETE FROM sandbox.account_balances WHERE fiscal_period_id IN (SELECT id FROM sandbox.fiscal_periods WHERE company_id=$1)`);
    await wipe('ar_cm_applications',     `DELETE FROM sandbox.ar_credit_memo_applications WHERE cm_id IN (SELECT id FROM sandbox.ar_credit_memos WHERE company_id=$1)`);
    await wipe('ar_cm_lines',            `DELETE FROM sandbox.ar_credit_memo_lines WHERE credit_memo_id IN (SELECT id FROM sandbox.ar_credit_memos WHERE company_id=$1)`);
    await wipe('ar_credit_memos',        `DELETE FROM sandbox.ar_credit_memos WHERE company_id=$1`);
    await wipe('payment_applications',   `DELETE FROM sandbox.payment_applications WHERE payment_id IN (SELECT id FROM sandbox.customer_payments WHERE company_id=$1)`);
    await wipe('customer_payments',      `DELETE FROM sandbox.customer_payments WHERE company_id=$1`);
    await wipe('bill_pay_applications',  `DELETE FROM sandbox.bill_payment_applications WHERE payment_id IN (SELECT id FROM sandbox.supplier_payments WHERE company_id=$1)`);
    await wipe('supplier_payments',      `DELETE FROM sandbox.supplier_payments WHERE company_id=$1`);
    await wipe('allocation_lines',       `DELETE FROM sandbox.order_allocation_lines WHERE allocation_id IN (SELECT id FROM sandbox.order_allocations WHERE company_id=$1)`);
    await wipe('order_allocations',      `DELETE FROM sandbox.order_allocations WHERE company_id=$1`);
    await wipe('expense_report_lines',   `DELETE FROM sandbox.expense_report_lines WHERE er_id IN (SELECT id FROM sandbox.employee_expense_reports WHERE company_id=$1)`);
    await wipe('employee_expense_reports',`DELETE FROM sandbox.employee_expense_reports WHERE company_id=$1`);
    await wipe('bill_lines',             `DELETE FROM sandbox.bill_lines WHERE bill_id IN (SELECT id FROM sandbox.bills WHERE company_id=$1)`);
    await wipe('bills',                  `DELETE FROM sandbox.bills WHERE company_id=$1`);
    await wipe('goods_receipt_lines',    `DELETE FROM sandbox.goods_receipt_lines WHERE grn_id IN (SELECT id FROM sandbox.goods_receipts WHERE company_id=$1)`);
    await wipe('goods_receipts',         `DELETE FROM sandbox.goods_receipts WHERE company_id=$1`);
    await wipe('purchase_order_lines',   `DELETE FROM sandbox.purchase_order_lines WHERE po_id IN (SELECT id FROM sandbox.purchase_orders WHERE company_id=$1)`);
    await wipe('purchase_orders',        `DELETE FROM sandbox.purchase_orders WHERE company_id=$1`);
    await wipe('sales_invoice_lines',    `DELETE FROM sandbox.sales_invoice_lines WHERE invoice_id IN (SELECT id FROM sandbox.sales_invoices WHERE company_id=$1)`);
    await wipe('sales_invoices',         `DELETE FROM sandbox.sales_invoices WHERE company_id=$1`);
    await wipe('delivery_receipt_lines', `DELETE FROM sandbox.delivery_receipt_lines WHERE dr_id IN (SELECT id FROM sandbox.delivery_receipts WHERE company_id=$1)`);
    await wipe('delivery_receipts',      `DELETE FROM sandbox.delivery_receipts WHERE company_id=$1`);
    await wipe('sales_order_lines',      `DELETE FROM sandbox.sales_order_lines WHERE order_id IN (SELECT id FROM sandbox.sales_orders WHERE company_id=$1)`);
    await wipe('sales_orders',           `DELETE FROM sandbox.sales_orders WHERE company_id=$1`);
    await wipe('poultry_invoice_lines',  `DELETE FROM sandbox.poultry_invoice_lines WHERE invoice_id IN (SELECT id FROM sandbox.poultry_invoices WHERE company_id=$1)`);
    await wipe('poultry_invoices',       `DELETE FROM sandbox.poultry_invoices WHERE company_id=$1`);
    await wipe('poultry_delivery_lines', `DELETE FROM sandbox.poultry_delivery_lines WHERE delivery_id IN (SELECT id FROM sandbox.poultry_deliveries WHERE company_id=$1)`);
    await wipe('poultry_deliveries',     `DELETE FROM sandbox.poultry_deliveries WHERE company_id=$1`);
    await wipe('sales_tally_lines',      `DELETE FROM sandbox.sales_tally_lines WHERE tally_id IN (SELECT id FROM sandbox.sales_tally_sheets WHERE company_id=$1)`);
    await wipe('sales_tally_sheets',     `DELETE FROM sandbox.sales_tally_sheets WHERE company_id=$1`);
    await wipe('conversion_outputs',     `DELETE FROM sandbox.conversion_outputs WHERE conversion_id IN (SELECT id FROM sandbox.conversions WHERE company_id=$1)`);
    await wipe('conversions',            `DELETE FROM sandbox.conversions WHERE company_id=$1`);
    await wipe('tally_sheet_lines',      `DELETE FROM sandbox.tally_sheet_lines WHERE tally_sheet_id IN (SELECT id FROM sandbox.tally_sheets WHERE company_id=$1)`);
    await wipe('tally_sheets',           `DELETE FROM sandbox.tally_sheets WHERE company_id=$1`);
    await wipe('grow_daily_mortality',   `DELETE FROM sandbox.grow_daily_mortality WHERE grow_cycle_id IN (SELECT id FROM sandbox.grow_cycles WHERE company_id=$1)`);
    await wipe('grow_weekly_weights',    `DELETE FROM sandbox.grow_weekly_weights WHERE grow_cycle_id IN (SELECT id FROM sandbox.grow_cycles WHERE company_id=$1)`);
    await wipe('grow_item_consumption',  `DELETE FROM sandbox.grow_item_consumption WHERE grow_cycle_id IN (SELECT id FROM sandbox.grow_cycles WHERE company_id=$1)`);
    await wipe('grow_mortality_logs',    `DELETE FROM sandbox.grow_mortality_logs WHERE grow_cycle_id IN (SELECT id FROM sandbox.grow_cycles WHERE company_id=$1)`);
    await wipe('chick_batches',          `DELETE FROM sandbox.chick_batches WHERE company_id=$1`);
    await wipe('grow_cycles',            `DELETE FROM sandbox.grow_cycles WHERE company_id=$1`);
    await wipe('inventory_in_lines',     `DELETE FROM sandbox.inventory_in_lines WHERE inventory_in_id IN (SELECT id FROM sandbox.inventory_ins WHERE company_id=$1)`);
    await wipe('inventory_ins',          `DELETE FROM sandbox.inventory_ins WHERE company_id=$1`);
    await wipe('order_in_lines',         `DELETE FROM sandbox.order_in_lines WHERE order_in_id IN (SELECT id FROM sandbox.order_ins WHERE company_id=$1)`);
    await wipe('order_ins',              `DELETE FROM sandbox.order_ins WHERE company_id=$1`);
    await wipe('stock_adjustment_lines', `DELETE FROM sandbox.stock_adjustment_lines WHERE adj_id IN (SELECT id FROM sandbox.stock_adjustments WHERE company_id=$1)`);
    await wipe('stock_adjustments',      `DELETE FROM sandbox.stock_adjustments WHERE company_id=$1`);
    await wipe('stock_transfer_lines',   `DELETE FROM sandbox.stock_transfer_lines WHERE transfer_id IN (SELECT id FROM sandbox.stock_transfers WHERE company_id=$1)`);
    await wipe('stock_transfers',        `DELETE FROM sandbox.stock_transfers WHERE company_id=$1`);
    await wipe('stock_count_lines',      `DELETE FROM sandbox.stock_count_lines WHERE count_id IN (SELECT id FROM sandbox.stock_counts WHERE company_id=$1)`);
    await wipe('stock_counts',           `DELETE FROM sandbox.stock_counts WHERE company_id=$1`);
    await wipe('inventory_reservations', `DELETE FROM sandbox.inventory_reservations WHERE company_id=$1`);
    await wipe('stock_balances',         `DELETE FROM sandbox.stock_balances WHERE company_id=$1`);
    await wipe('poultry_inv_ledger',     `DELETE FROM sandbox.poultry_inventory_ledger WHERE company_id=$1`);
    await wipe('poultry_inv_balance',    `DELETE FROM sandbox.poultry_inventory_balance WHERE company_id=$1`);

    // Master data (children first)
    await wipe('employees',              `DELETE FROM sandbox.employees WHERE company_id=$1`);
    await wipe('payment_methods',        `DELETE FROM sandbox.payment_methods WHERE company_id=$1`);
    await wipe('items',                  `DELETE FROM sandbox.items WHERE company_id=$1`);
    await wipe('customers',              `DELETE FROM sandbox.customers WHERE company_id=$1`);
    await wipe('suppliers',              `DELETE FROM sandbox.suppliers WHERE company_id=$1`);
    await wipe('farm_buildings',         `DELETE FROM sandbox.farm_buildings WHERE company_id=$1`);
    await wipe('warehouses',             `DELETE FROM sandbox.warehouses WHERE company_id=$1`);
    await wipe('departments',            `DELETE FROM sandbox.departments WHERE company_id=$1`);
    await wipe('cost_centers',           `DELETE FROM sandbox.cost_centers WHERE company_id=$1`);
    await wipe('item_categories',        `DELETE FROM sandbox.item_categories WHERE company_id=$1`);
    await wipe('accounts',               `DELETE FROM sandbox.accounts WHERE company_id=$1`);
    await wipe('uoms',                   `DELETE FROM sandbox.uoms WHERE company_id=$1`);
    await wipe('delivery_methods',       `DELETE FROM sandbox.delivery_methods WHERE company_id=$1`);
    await wipe('grow_references',        `DELETE FROM sandbox.grow_references WHERE company_id=$1`);
    await wipe('fiscal_periods',         `DELETE FROM sandbox.fiscal_periods WHERE company_id=$1`);
    await wipe('fiscal_years',           `DELETE FROM sandbox.fiscal_years WHERE company_id=$1`);
    await wipe('document_series',        `DELETE FROM sandbox.document_series WHERE company_id=$1`);
    await wipe('user_roles',             `DELETE FROM sandbox.user_roles WHERE company_id=$1`);
    await wipe('branches',               `DELETE FROM sandbox.branches WHERE company_id=$1`);

    // ══════════════════════════════════════════════════════════
    // PHASE 2 — Copy production → sandbox (parents first)
    // All tables use cross-schema INSERT ... SELECT *.
    // ══════════════════════════════════════════════════════════

    const copy = (label: string, sql: string, params: unknown[] = []) => step(`copy ${label}`, sql, params);

    // ── Global tables (upsert — no company_id) ──────────────────────────────
    await copy('roles',
      `INSERT INTO sandbox.roles SELECT * FROM public.roles ON CONFLICT (id) DO UPDATE
       SET code=EXCLUDED.code, name=EXCLUDED.name, description=EXCLUDED.description`);

    await copy('permissions',
      `INSERT INTO sandbox.permissions SELECT * FROM public.permissions ON CONFLICT (id) DO NOTHING`);

    await copy('role_permissions',
      `INSERT INTO sandbox.role_permissions SELECT * FROM public.role_permissions ON CONFLICT DO NOTHING`);

    await copy('feature_flags',
      `INSERT INTO sandbox.feature_flags SELECT * FROM public.feature_flags ON CONFLICT (id) DO UPDATE
       SET name=EXCLUDED.name, enabled=EXCLUDED.enabled, description=EXCLUDED.description,
           rollout_companies=EXCLUDED.rollout_companies, rollout_users=EXCLUDED.rollout_users`);

    // ── Users (upsert — shared across companies) ────────────────────────────
    await copy('users',
      `INSERT INTO sandbox.users (id, email, password_hash, full_name, is_active, is_superadmin)
       SELECT u.id, u.email, u.password_hash, u.full_name, u.is_active, u.is_superadmin
         FROM public.users u
        WHERE u.id IN (SELECT DISTINCT user_id FROM public.user_roles WHERE company_id=$1)
       ON CONFLICT (id) DO UPDATE SET
         email=EXCLUDED.email, password_hash=EXCLUDED.password_hash,
         full_name=EXCLUDED.full_name, is_active=EXCLUDED.is_active,
         is_superadmin=EXCLUDED.is_superadmin`,
      [company_id]);

    // ── Company ─────────────────────────────────────────────────────────────
    await copy('company',
      `INSERT INTO sandbox.companies SELECT * FROM public.companies WHERE id=$1
       ON CONFLICT (id) DO NOTHING`, [company_id]);

    // ── Branches ────────────────────────────────────────────────────────────
    await copy('branches',
      `INSERT INTO sandbox.branches SELECT * FROM public.branches WHERE company_id=$1`, [company_id]);

    // ── Warehouses (FK → branches) ──────────────────────────────────────────
    await copy('warehouses',
      `INSERT INTO sandbox.warehouses SELECT * FROM public.warehouses WHERE company_id=$1`, [company_id]);

    // ── Farm buildings (FK → branches) ─────────────────────────────────────
    await copy('farm_buildings',
      `INSERT INTO sandbox.farm_buildings SELECT * FROM public.farm_buildings WHERE company_id=$1`, [company_id]);

    // ── Chart of Accounts (self-referential parent_id FK — multi-pass) ──────
    // Pass 1: root accounts
    await copy('accounts L1',
      `INSERT INTO sandbox.accounts SELECT * FROM public.accounts
       WHERE company_id=$1 AND parent_id IS NULL`, [company_id]);
    // Pass 2: level 2 (parents now in sandbox)
    await copy('accounts L2',
      `INSERT INTO sandbox.accounts SELECT a.* FROM public.accounts a
       WHERE a.company_id=$1
         AND a.parent_id IN (SELECT id FROM sandbox.accounts WHERE company_id=$1)
         AND a.id NOT IN (SELECT id FROM sandbox.accounts WHERE company_id=$1)`, [company_id]);
    // Pass 3: level 3
    await copy('accounts L3',
      `INSERT INTO sandbox.accounts SELECT a.* FROM public.accounts a
       WHERE a.company_id=$1
         AND a.parent_id IN (SELECT id FROM sandbox.accounts WHERE company_id=$1)
         AND a.id NOT IN (SELECT id FROM sandbox.accounts WHERE company_id=$1)`, [company_id]);
    // Pass 4: any remaining deeper levels
    await copy('accounts L4+',
      `INSERT INTO sandbox.accounts SELECT a.* FROM public.accounts a
       WHERE a.company_id=$1
         AND a.id NOT IN (SELECT id FROM sandbox.accounts WHERE company_id=$1)
       ON CONFLICT (id) DO NOTHING`, [company_id]);

    // ── Item categories (self-referential parent_id) ─────────────────────────
    await copy('item_categories L1',
      `INSERT INTO sandbox.item_categories SELECT * FROM public.item_categories
       WHERE company_id=$1 AND parent_id IS NULL`, [company_id]);
    await copy('item_categories L2',
      `INSERT INTO sandbox.item_categories SELECT ic.* FROM public.item_categories ic
       WHERE ic.company_id=$1
         AND ic.parent_id IN (SELECT id FROM sandbox.item_categories WHERE company_id=$1)
         AND ic.id NOT IN (SELECT id FROM sandbox.item_categories WHERE company_id=$1)`, [company_id]);
    await copy('item_categories L3+',
      `INSERT INTO sandbox.item_categories SELECT ic.* FROM public.item_categories ic
       WHERE ic.company_id=$1
         AND ic.id NOT IN (SELECT id FROM sandbox.item_categories WHERE company_id=$1)
       ON CONFLICT (id) DO NOTHING`, [company_id]);

    // ── UOMs ────────────────────────────────────────────────────────────────
    await copy('uoms',
      `INSERT INTO sandbox.uoms SELECT * FROM public.uoms WHERE company_id=$1`, [company_id]);

    // ── Cost centers (self-referential parent_id) ────────────────────────────
    await copy('cost_centers L1',
      `INSERT INTO sandbox.cost_centers SELECT * FROM public.cost_centers
       WHERE company_id=$1 AND parent_id IS NULL`, [company_id]);
    await copy('cost_centers L2',
      `INSERT INTO sandbox.cost_centers SELECT cc.* FROM public.cost_centers cc
       WHERE cc.company_id=$1
         AND cc.parent_id IN (SELECT id FROM sandbox.cost_centers WHERE company_id=$1)
         AND cc.id NOT IN (SELECT id FROM sandbox.cost_centers WHERE company_id=$1)`, [company_id]);
    await copy('cost_centers L3+',
      `INSERT INTO sandbox.cost_centers SELECT cc.* FROM public.cost_centers cc
       WHERE cc.company_id=$1
         AND cc.id NOT IN (SELECT id FROM sandbox.cost_centers WHERE company_id=$1)
       ON CONFLICT (id) DO NOTHING`, [company_id]);

    // ── Departments ─────────────────────────────────────────────────────────
    await copy('departments',
      `INSERT INTO sandbox.departments SELECT * FROM public.departments WHERE company_id=$1`, [company_id]);

    // ── Delivery methods ────────────────────────────────────────────────────
    await copy('delivery_methods',
      `INSERT INTO sandbox.delivery_methods SELECT * FROM public.delivery_methods WHERE company_id=$1`, [company_id]);

    // ── Grow references ─────────────────────────────────────────────────────
    await copy('grow_references',
      `INSERT INTO sandbox.grow_references SELECT * FROM public.grow_references WHERE company_id=$1`, [company_id]);

    // ── Fiscal years ────────────────────────────────────────────────────────
    await copy('fiscal_years',
      `INSERT INTO sandbox.fiscal_years SELECT * FROM public.fiscal_years WHERE company_id=$1`, [company_id]);

    // ── Fiscal periods (FK → fiscal_years) ──────────────────────────────────
    await copy('fiscal_periods',
      `INSERT INTO sandbox.fiscal_periods SELECT * FROM public.fiscal_periods WHERE company_id=$1`, [company_id]);

    // ── Document series (current_number reset to 0) ──────────────────────────
    await copy('document_series',
      `INSERT INTO sandbox.document_series
       SELECT id, company_id, doc_type, prefix, start_number,
              0 AS current_number, branch_id, is_active, created_at, updated_at
         FROM public.document_series WHERE company_id=$1`, [company_id]);

    // ── Items (FK → item_categories, accounts) ───────────────────────────────
    await copy('items',
      `INSERT INTO sandbox.items SELECT * FROM public.items WHERE company_id=$1`, [company_id]);

    // ── Customers (FK → accounts) ────────────────────────────────────────────
    await copy('customers',
      `INSERT INTO sandbox.customers SELECT * FROM public.customers WHERE company_id=$1`, [company_id]);

    // ── Suppliers (FK → accounts) ────────────────────────────────────────────
    await copy('suppliers',
      `INSERT INTO sandbox.suppliers SELECT * FROM public.suppliers WHERE company_id=$1`, [company_id]);

    // ── Payment methods (FK → accounts) ─────────────────────────────────────
    await copy('payment_methods',
      `INSERT INTO sandbox.payment_methods SELECT * FROM public.payment_methods WHERE company_id=$1`, [company_id]);

    // ── User roles ───────────────────────────────────────────────────────────
    await copy('user_roles',
      `INSERT INTO sandbox.user_roles SELECT * FROM public.user_roles WHERE company_id=$1`, [company_id]);

    // ── Employees (FK → departments, users) ──────────────────────────────────
    await copy('employees',
      `INSERT INTO sandbox.employees SELECT * FROM public.employees WHERE company_id=$1`, [company_id]);

    // ── App settings (global key-value) ─────────────────────────────────────
    await copy('app_settings',
      `INSERT INTO sandbox.app_settings (key, value) SELECT key, value FROM public.app_settings
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`);

    await conn.query('COMMIT');
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => {});
    conn.release();
    return err((e as Error).message, 500);
  }
  conn.release();

  return ok({ message: 'Sandbox synced from production successfully.', results });
}
