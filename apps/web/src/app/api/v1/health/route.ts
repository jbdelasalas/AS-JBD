export const dynamic = 'force-dynamic';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const REQUIRED_TABLES = [
  'users', 'roles', 'permissions', 'role_permissions', 'user_roles',
  'companies', 'branches', 'accounts', 'fiscal_periods', 'document_series',
  'customers', 'suppliers', 'bills', 'bill_lines', 'supplier_payments',
  'purchase_orders', 'goods_receipts',
  'items', 'warehouses', 'stock_balances', 'stock_adjustments',
  'stock_transfers', 'stock_counts',
  'cost_centers', 'fiscal_years', 'uoms', 'payment_methods',
  'approval_workflows', 'feature_flags',
];

export async function GET() {
  try {
    await query('SELECT 1');
  } catch (e) {
    return err(`db connection error: ${(e as Error).message}`, 503);
  }

  try {
    const existingRows = await query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    const existing = new Set(existingRows.map((r) => r.tablename));
    const missing = REQUIRED_TABLES.filter((t) => !existing.has(t));

    return ok({
      status: missing.length === 0 ? 'ok' : 'migrations_needed',
      db: 'connected',
      missing_tables: missing,
    });
  } catch (e) {
    return ok({ status: 'ok', db: 'connected', missing_tables: [] });
  }
}
