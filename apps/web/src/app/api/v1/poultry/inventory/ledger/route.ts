export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  const itemId = searchParams.get('item_id');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '200'), 1000);

  const params: unknown[] = [companyId];
  let where = `l.company_id = $1`;
  if (itemId) { params.push(itemId); where += ` AND l.item_id = $${params.length}`; }
  if (from) { params.push(from); where += ` AND l.transaction_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND l.transaction_date <= $${params.length}`; }
  params.push(limit);

  try {
    const rows = await query(
      `SELECT l.id, l.transaction_date, l.movement_type, l.source_type, l.source_doc_no,
              l.heads_in, l.heads_out, l.kgs_in, l.kgs_out, l.unit_cost, l.total_cost,
              l.balance_heads, l.balance_kgs,
              i.sku, i.name AS item_name,
              w.name AS warehouse_name
         FROM poultry_inventory_ledger l
         JOIN items i ON i.id = l.item_id
         LEFT JOIN warehouses w ON w.id = l.warehouse_id
        WHERE ${where}
        ORDER BY l.transaction_date DESC, l.created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return ok(rows);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
