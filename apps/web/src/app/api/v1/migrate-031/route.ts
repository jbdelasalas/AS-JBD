export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// All 4 tagging columns for a given table
function tag(table: string): [string, string][] {
  return [
    [`${table}.branch_id`,        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS branch_id        uuid REFERENCES branches(id)`],
    [`${table}.building_id`,      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS building_id      uuid REFERENCES farm_buildings(id)`],
    [`${table}.cost_center_id`,   `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)`],
    [`${table}.grow_reference_id`,`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
  ];
}

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const steps: [string, string][] = [
    // ── purchase_orders ──────────────────────────────────────────────────────
    ['purchase_orders.remarks',              `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS remarks text`],
    ...tag('purchase_orders'),
    ...tag('purchase_order_lines'),
    ['purchase_order_lines.gl_account_id',   `ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES accounts(id)`],
    ['purchase_order_lines.item_id_nullable',`ALTER TABLE purchase_order_lines ALTER COLUMN item_id DROP NOT NULL`],

    // ── goods_receipts ───────────────────────────────────────────────────────
    ...tag('goods_receipts'),
    ['goods_receipts.warehouse_id_nullable', `ALTER TABLE goods_receipts ALTER COLUMN warehouse_id DROP NOT NULL`],
    ...tag('goods_receipt_lines'),

    // ── bills (AP) ───────────────────────────────────────────────────────────
    ...tag('bills'),
    ...tag('bill_lines'),

    // ── sales orders / invoices (AR) ─────────────────────────────────────────
    ...tag('sales_orders'),
    ...tag('sales_order_lines'),
    ...tag('sales_invoices'),
    ...tag('sales_invoice_lines'),

    // ── payments ─────────────────────────────────────────────────────────────
    ...tag('customer_payments'),

    // ── delivery_methods ─────────────────────────────────────────────────────
    ['delivery_methods table', `
      CREATE TABLE IF NOT EXISTS delivery_methods (
        id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        code        varchar(50) NOT NULL,
        name        varchar(100) NOT NULL,
        sort_order  int NOT NULL DEFAULT 99,
        is_active   boolean NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, code)
      )
    `],
    ['delivery_methods seed', `
      INSERT INTO delivery_methods (company_id, code, name, sort_order)
      SELECT c.id, 'IN_HOUSE',    'IN HOUSE',    1 FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM delivery_methods d WHERE d.company_id = c.id AND d.code = 'IN_HOUSE')
      UNION ALL
      SELECT c.id, 'PICK_UP',     'PICK UP',     2 FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM delivery_methods d WHERE d.company_id = c.id AND d.code = 'PICK_UP')
      UNION ALL
      SELECT c.id, 'THIRD_PARTY', 'THIRD PARTY', 3 FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM delivery_methods d WHERE d.company_id = c.id AND d.code = 'THIRD_PARTY')
    `],

    // ── tally_sheets ─────────────────────────────────────────────────────────
    ...tag('tally_sheets'),
    ...tag('tally_sheet_lines'),

    // ── conversions ──────────────────────────────────────────────────────────
    ['conversions.target_branch_id',     `ALTER TABLE conversions ADD COLUMN IF NOT EXISTS target_branch_id uuid REFERENCES branches(id)`],
    ['conversions.po_id',                `ALTER TABLE conversions ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES purchase_orders(id)`],
    ['conversions.doa_heads',            `ALTER TABLE conversions ADD COLUMN IF NOT EXISTS doa_heads numeric(14,4) DEFAULT 0`],
    ['conversions.doa_kgs',              `ALTER TABLE conversions ADD COLUMN IF NOT EXISTS doa_kgs numeric(14,4) DEFAULT 0`],
    ['conversions.short_over_heads',     `ALTER TABLE conversions ADD COLUMN IF NOT EXISTS short_over_heads numeric(14,4) DEFAULT 0`],
    ['conversions.short_over_kgs',       `ALTER TABLE conversions ADD COLUMN IF NOT EXISTS short_over_kgs numeric(14,4) DEFAULT 0`],
    ['conversion_outputs.category',      `ALTER TABLE conversion_outputs ADD COLUMN IF NOT EXISTS category text`],
    ['conversion_outputs.delivery_ref_no',`ALTER TABLE conversion_outputs ADD COLUMN IF NOT EXISTS delivery_ref_no text`],

    // ── grow_cycles ──────────────────────────────────────────────────────────
    ['grow_cycles.cost_center_id', `ALTER TABLE grow_cycles ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id)`],
    ['grow_cycles.live_item_id',   `ALTER TABLE grow_cycles ADD COLUMN IF NOT EXISTS live_item_id uuid REFERENCES items(id)`],

    // ── poultry_inventory_balance avg_cost ───────────────────────────────────
    ['poultry_inventory_balance.avg_cost', `ALTER TABLE poultry_inventory_balance ADD COLUMN IF NOT EXISTS avg_cost numeric(18,6) DEFAULT 0`],
  ];

  const results: string[] = [];
  for (const [label, sql] of steps) {
    try {
      await query(sql);
      results.push(`ok: ${label}`);
    } catch (e) {
      results.push(`err: ${label} — ${(e as Error).message}`);
    }
  }

  return ok({ results });
}
