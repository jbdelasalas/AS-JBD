export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];

  // 035 — item document series
  try {
    await query(
      `INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
       SELECT c.id, 'item', 'ITEM', 1, 0
       FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM document_series ds WHERE ds.company_id = c.id AND ds.doc_type = 'item')`,
    );
    results.push('ok: 035 document_series item');
  } catch (e) { results.push(`err: 035 document_series item — ${(e as Error).message}`); }

  // 036 — je_id on goods_receipts
  try {
    await query(`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS je_id uuid REFERENCES journal_entries(id)`);
    results.push('ok: 036 goods_receipts.je_id');
  } catch (e) { results.push(`err: 036 goods_receipts.je_id — ${(e as Error).message}`); }

  // 036b — Advances to Suppliers account for all companies
  try {
    await query(
      `INSERT INTO accounts (company_id, code, name, account_type, is_control, is_active)
       SELECT c.id, '11021', 'Advances to Suppliers', 'ASSET', false, true
       FROM companies c
       WHERE NOT EXISTS (
         SELECT 1 FROM accounts a
          WHERE a.company_id = c.id
            AND (a.code = '11021'
                 OR a.name ILIKE '%advances to supplier%'
                 OR (a.name ILIKE '%advance%' AND a.name ILIKE '%supplier%'))
       )`,
    );
    results.push('ok: 036b advances_to_suppliers account');
  } catch (e) { results.push(`err: 036b advances_to_suppliers — ${(e as Error).message}`); }

  // 039 — je_id on stock_adjustments + seed Inventory Adjustment account
  try {
    await query(`ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS je_id uuid REFERENCES journal_entries(id)`);
    results.push('ok: 039 stock_adjustments.je_id');
  } catch (e) { results.push(`err: 039 stock_adjustments.je_id — ${(e as Error).message}`); }

  try {
    await query(
      `INSERT INTO accounts (company_id, code, name, account_type, is_control, is_active)
       SELECT c.id, '5020', 'Inventory Adjustment', 'EXPENSE', false, true
       FROM companies c
       WHERE NOT EXISTS (
         SELECT 1 FROM accounts a WHERE a.company_id = c.id
           AND (a.code = '5020' OR a.name ILIKE '%inventory adjustment%')
       )`,
    );
    results.push('ok: 039 Inventory Adjustment account seeded');
  } catch (e) { results.push(`err: 039 Inventory Adjustment account — ${(e as Error).message}`); }

  // 038 — mark inventory GL accounts as control accounts (prevents manual JE posting)
  try {
    await query(
      `UPDATE accounts SET is_control = true
        WHERE is_active = true
          AND account_type = 'ASSET'
          AND (code = '1200' OR name ILIKE '%merchandise inventory%' OR name ILIKE '%finished goods inventory%' OR name ILIKE '%raw materials inventory%')
          AND is_control = false`,
    );
    results.push('ok: 038 inventory accounts marked as control');
  } catch (e) { results.push(`err: 038 inventory control — ${(e as Error).message}`); }

  // 037 — branch/building/cost_center on sales_order_lines and sales_invoice_lines
  const lineTags037: [string, string][] = [
    ['sales_order_lines.branch_id',       `ALTER TABLE sales_order_lines    ADD COLUMN IF NOT EXISTS branch_id       uuid REFERENCES branches(id)`],
    ['sales_order_lines.building_id',     `ALTER TABLE sales_order_lines    ADD COLUMN IF NOT EXISTS building_id     uuid REFERENCES farm_buildings(id)`],
    ['sales_order_lines.cost_center_id',  `ALTER TABLE sales_order_lines    ADD COLUMN IF NOT EXISTS cost_center_id  uuid REFERENCES cost_centers(id)`],
    ['sales_invoice_lines.branch_id',     `ALTER TABLE sales_invoice_lines  ADD COLUMN IF NOT EXISTS branch_id       uuid REFERENCES branches(id)`],
    ['sales_invoice_lines.building_id',   `ALTER TABLE sales_invoice_lines  ADD COLUMN IF NOT EXISTS building_id     uuid REFERENCES farm_buildings(id)`],
    ['sales_invoice_lines.cost_center_id',`ALTER TABLE sales_invoice_lines  ADD COLUMN IF NOT EXISTS cost_center_id  uuid REFERENCES cost_centers(id)`],
  ];
  for (const [label, sql] of lineTags037) {
    try { await query(sql); results.push(`ok: 037 ${label}`); }
    catch (e) { results.push(`err: 037 ${label} — ${(e as Error).message}`); }
  }

  return ok({ results });
}
