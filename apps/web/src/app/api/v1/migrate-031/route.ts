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
    ['sales_invoices.dr_id', `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS dr_id uuid REFERENCES delivery_receipts(id)`],
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

    // ── goods_receipts GL columns ─────────────────────────────────────────────
    ['goods_receipts.je_id',     `ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS je_id uuid REFERENCES journal_entries(id)`],
    ['goods_receipts.posted_by', `ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES users(id)`],

    // ── GRNI account seed ─────────────────────────────────────────────────────
    ['accounts.grni_seed', `
      INSERT INTO accounts (company_id, code, name, account_type, is_active, is_control)
      SELECT c.id, '21100', 'Goods Received Not Yet Invoiced', 'LIABILITY', true, false
      FROM companies c
      WHERE NOT EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.company_id = c.id
          AND (a.name ILIKE '%grni%' OR a.name ILIKE '%goods received not yet%' OR a.code = '21100')
      )
    `],

    // ── supplier_payments remarks ─────────────────────────────────────────────
    ['supplier_payments.remarks', `ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS remarks text`],

    // ── sales_orders with_si flag ─────────────────────────────────────────────
    ['sales_orders.with_si', `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS with_si boolean NOT NULL DEFAULT true`],

    // ── bank_accounts master ──────────────────────────────────────────────────
    ['bank_accounts table', `
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        account_name   text NOT NULL,
        bank_name      text,
        account_number text,
        gl_account_id  uuid REFERENCES accounts(id),
        is_active      boolean NOT NULL DEFAULT true,
        created_at     timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, account_name)
      )
    `],
    ['bank_accounts seed from COA', `
      INSERT INTO bank_accounts (company_id, account_name, bank_name, account_number, gl_account_id)
      SELECT
        a.company_id,
        a.name,
        CASE
          WHEN a.name ILIKE '%BDO%'   THEN 'BDO Unibank'
          WHEN a.name ILIKE '%SBC%'   THEN 'Security Bank'
          WHEN a.name ILIKE '%Petty%' THEN NULL
          ELSE NULL
        END,
        CASE
          WHEN a.name ~ '\(([^)]+)\)' THEN substring(a.name FROM '\(([^)]+)\)')
          ELSE NULL
        END,
        a.id
      FROM accounts a
      WHERE a.is_active = true
        AND (
          a.name ILIKE '%Cash in Bank%'
          OR a.name ILIKE '%Petty Cash%'
        )
        AND NOT EXISTS (
          SELECT 1 FROM bank_accounts b
          WHERE b.company_id = a.company_id AND b.gl_account_id = a.id
        )
    `],

    // ── Order Allocation module ───────────────────────────────────────────────
    ['order_allocations table', `
      CREATE TABLE IF NOT EXISTS order_allocations (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        allocation_no     varchar(50) NOT NULL,
        so_id             uuid REFERENCES sales_orders(id),
        customer_id       uuid NOT NULL REFERENCES customers(id),
        customer_name     text,
        allocation_date   date NOT NULL,
        delivery_date     date,
        reference         text,
        notes             text,
        status            varchar(20) NOT NULL DEFAULT 'draft',
        with_si           boolean NOT NULL DEFAULT true,
        branch_id         uuid REFERENCES branches(id),
        building_id       uuid REFERENCES farm_buildings(id),
        cost_center_id    uuid REFERENCES cost_centers(id),
        grow_reference_id uuid REFERENCES grow_references(id),
        tally_sheet_id    uuid,
        posted_by         uuid REFERENCES users(id),
        posted_at         timestamptz,
        created_by        uuid REFERENCES users(id),
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, allocation_no)
      )
    `],
    ['order_allocation_lines table', `
      CREATE TABLE IF NOT EXISTS order_allocation_lines (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        allocation_id     uuid NOT NULL REFERENCES order_allocations(id) ON DELETE CASCADE,
        line_no           int NOT NULL,
        item_id           uuid REFERENCES items(id),
        description       text NOT NULL DEFAULT '',
        qty_ordered       numeric(14,4) NOT NULL DEFAULT 0,
        qty_allocated     numeric(14,4) NOT NULL DEFAULT 0,
        allocation_unit   varchar(20) NOT NULL DEFAULT 'Pcs',
        unit_price        numeric(14,4) NOT NULL DEFAULT 0,
        discount_pct      numeric(5,2) NOT NULL DEFAULT 0,
        vat_rate          numeric(5,2) NOT NULL DEFAULT 12,
        branch_id         uuid REFERENCES branches(id),
        building_id       uuid REFERENCES farm_buildings(id),
        cost_center_id    uuid REFERENCES cost_centers(id),
        grow_reference_id uuid REFERENCES grow_references(id)
      )
    `],

    // ── Sales Tally Sheets (auto-created on allocation post) ──────────────────
    ['sales_tally_sheets table', `
      CREATE TABLE IF NOT EXISTS sales_tally_sheets (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        tally_no          varchar(50) NOT NULL,
        allocation_id     uuid REFERENCES order_allocations(id),
        customer_id       uuid NOT NULL REFERENCES customers(id),
        customer_name     text,
        tally_date        date NOT NULL,
        delivery_date     date,
        reference         text,
        notes             text,
        status            varchar(20) NOT NULL DEFAULT 'draft',
        branch_id         uuid REFERENCES branches(id),
        building_id       uuid REFERENCES farm_buildings(id),
        cost_center_id    uuid REFERENCES cost_centers(id),
        grow_reference_id uuid REFERENCES grow_references(id),
        created_by        uuid REFERENCES users(id),
        created_at        timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, tally_no)
      )
    `],
    ['sales_tally_lines table', `
      CREATE TABLE IF NOT EXISTS sales_tally_lines (
        id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tally_id            uuid NOT NULL REFERENCES sales_tally_sheets(id) ON DELETE CASCADE,
        line_no             int NOT NULL,
        allocation_line_id  uuid REFERENCES order_allocation_lines(id),
        item_id             uuid REFERENCES items(id),
        description         text NOT NULL DEFAULT '',
        qty_allocated       numeric(14,4) NOT NULL DEFAULT 0,
        allocation_unit     varchar(20) NOT NULL DEFAULT 'Pcs',
        actual_qty          numeric(14,4) NOT NULL DEFAULT 0,
        actual_weight_kgs   numeric(14,4) NOT NULL DEFAULT 0,
        unit_price          numeric(14,4) NOT NULL DEFAULT 0,
        remarks             text
      )
    `],

    // ── customer_payments: deduction fields (CWT etc.) ───────────────────────
    ['customer_payments.deduction1_account_id', `ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS deduction1_account_id uuid REFERENCES accounts(id)`],
    ['customer_payments.deduction1_label',      `ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS deduction1_label      text`],
    ['customer_payments.deduction1_amount',     `ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS deduction1_amount     numeric(14,2) NOT NULL DEFAULT 0`],
    ['customer_payments.deduction2_account_id', `ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS deduction2_account_id uuid REFERENCES accounts(id)`],
    ['customer_payments.deduction2_label',      `ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS deduction2_label      text`],
    ['customer_payments.deduction2_amount',     `ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS deduction2_amount     numeric(14,2) NOT NULL DEFAULT 0`],

    // ── sales_tally_lines: ensure all columns exist (table may predate these columns) ─
    ['sales_tally_lines.actual_qty',        `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS actual_qty         numeric(14,4) NOT NULL DEFAULT 0`],
    ['sales_tally_lines.actual_weight_kgs', `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS actual_weight_kgs  numeric(14,4) NOT NULL DEFAULT 0`],
    ['sales_tally_lines.remarks',           `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS remarks             text`],
    ['sales_tally_lines.unit_price',        `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS unit_price          numeric(14,4) NOT NULL DEFAULT 0`],
    ['sales_tally_lines.allocation_unit',   `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS allocation_unit     varchar(20) NOT NULL DEFAULT 'Pcs'`],
    ['sales_tally_lines.qty_allocated',     `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS qty_allocated        numeric(14,4) NOT NULL DEFAULT 0`],
    ['sales_tally_lines.allocation_line_id',`ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS allocation_line_id  uuid REFERENCES order_allocation_lines(id)`],

    // ── sales_tally_sheets: ensure status column exists ───────────────────────
    ['sales_tally_sheets.status',           `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'draft'`],

    // ── sales_tally_sheets: so_id + dr_id for direct SO linkage and DR tracking ─
    ['sales_tally_sheets.so_id', `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS so_id uuid REFERENCES sales_orders(id)`],
    ['sales_tally_sheets.dr_id', `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS dr_id uuid REFERENCES delivery_receipts(id)`],
    ['sales_tally_sheets.poultry_tally_id', `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS poultry_tally_id uuid REFERENCES tally_sheets(id)`],

    // ── delivery_receipts: tally_sheet_id back-link + tagging columns ─────────
    ['delivery_receipts.tally_sheet_id',    `ALTER TABLE delivery_receipts ADD COLUMN IF NOT EXISTS tally_sheet_id    uuid REFERENCES sales_tally_sheets(id)`],
    ['delivery_receipts.building_id',       `ALTER TABLE delivery_receipts ADD COLUMN IF NOT EXISTS building_id        uuid REFERENCES farm_buildings(id)`],
    ['delivery_receipts.cost_center_id',    `ALTER TABLE delivery_receipts ADD COLUMN IF NOT EXISTS cost_center_id     uuid REFERENCES cost_centers(id)`],
    ['delivery_receipts.grow_reference_id', `ALTER TABLE delivery_receipts ADD COLUMN IF NOT EXISTS grow_reference_id  uuid REFERENCES grow_references(id)`],
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
