export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== 'migrate-as-jbd-2026') return err('Forbidden', 403);

  const results: string[] = [];
  for (const col of [
    'inventory_account_id',
    'cogs_account_id',
    'revenue_account_id',
    'purchase_variance_account_id',
  ]) {
    try {
      await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS ${col} uuid REFERENCES accounts(id)`);
      results.push(`items.${col}: ok`);
    } catch (e) {
      results.push(`items.${col}: ${(e as Error).message}`);
    }
  }

  // default_warehouse_id — used as both Location and Warehouse on item forms
  try {
    await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS default_warehouse_id uuid REFERENCES warehouses(id)`);
    results.push('items.default_warehouse_id: ok');
  } catch (e) {
    results.push(`items.default_warehouse_id: ${(e as Error).message}`);
  }

  // purchase_orders: add remarks column
  try {
    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS remarks text`);
    results.push('purchase_orders.remarks: ok');
  } catch (e) {
    results.push(`purchase_orders.remarks: ${(e as Error).message}`);
  }

  // purchase_order_lines: allow nullable item_id (GL-account lines have no item)
  try {
    await query(`ALTER TABLE purchase_order_lines ALTER COLUMN item_id DROP NOT NULL`);
    results.push('purchase_order_lines.item_id nullable: ok');
  } catch (e) {
    results.push(`purchase_order_lines.item_id nullable: ${(e as Error).message}`);
  }

  // purchase_order_lines: per-line tagging columns
  for (const [col, ref] of [
    ['branch_id',      'branches(id)'],
    ['building_id',    'farm_buildings(id)'],
    ['cost_center_id', 'cost_centers(id)'],
  ] as [string, string][]) {
    try {
      await query(`ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS ${col} uuid REFERENCES ${ref}`);
      results.push(`purchase_order_lines.${col}: ok`);
    } catch (e) {
      results.push(`purchase_order_lines.${col}: ${(e as Error).message}`);
    }
  }

  return ok({ results });
}
