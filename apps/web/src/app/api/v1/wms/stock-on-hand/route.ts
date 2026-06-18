export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Bin-level stock-on-hand from the bin_stock_balances sub-ledger.
// (Warehouse-level totals remain available at /inventory/stock-on-hand.)
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `bsb.company_id = $1`;
  const warehouseId = searchParams.get('warehouse_id');
  if (warehouseId) { params.push(warehouseId); where += ` AND bsb.warehouse_id = $${params.length}`; }
  const binId = searchParams.get('bin_id');
  if (binId) { params.push(binId); where += ` AND bsb.bin_id = $${params.length}`; }
  const search = searchParams.get('search');
  if (search) { params.push(`%${search}%`); where += ` AND (i.sku ILIKE $${params.length} OR i.name ILIKE $${params.length})`; }
  if (searchParams.get('hide_zero') === 'true') where += ` AND bsb.qty_on_hand <> 0`;

  const rows = await query(
    `SELECT bsb.id, bsb.item_id, bsb.bin_id, bsb.lot_id,
            i.sku, i.name AS item_name, i.uom,
            w.name AS warehouse_name, b.code AS bin_code, b.zone, b.bin_type,
            l.lot_no, l.expiry_date,
            bsb.qty_on_hand, bsb.avg_cost,
            bsb.qty_on_hand * bsb.avg_cost AS stock_value,
            bsb.last_movement_at
       FROM bin_stock_balances bsb
       JOIN items i ON i.id = bsb.item_id
       JOIN warehouses w ON w.id = bsb.warehouse_id
       JOIN bins b ON b.id = bsb.bin_id
       LEFT JOIN item_lots l ON l.id = bsb.lot_id
      WHERE ${where}
      ORDER BY w.name, b.code, i.sku`,
    params,
  );

  return ok(rows.map((r) => ({
    ...r,
    qty_on_hand: Number(r.qty_on_hand),
    avg_cost:    Number(r.avg_cost),
    stock_value: Number(r.stock_value),
  })));
}
