export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Lots with their current on-hand (summed across bins) and expiry.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `l.company_id = $1`;
  const itemId = searchParams.get('item_id');
  if (itemId) { params.push(itemId); where += ` AND l.item_id = $${params.length}`; }
  const search = searchParams.get('search');
  if (search) { params.push(`%${search}%`); where += ` AND (i.sku ILIKE $${params.length} OR i.name ILIKE $${params.length} OR l.lot_no ILIKE $${params.length})`; }

  const rows = await query(
    `SELECT l.id, l.lot_no, l.expiry_date, l.received_at,
            i.sku, i.name AS item_name, i.uom,
            COALESCE(SUM(bsb.qty_on_hand), 0) AS qty_on_hand
       FROM item_lots l
       JOIN items i ON i.id = l.item_id
       LEFT JOIN bin_stock_balances bsb ON bsb.lot_id = l.id
      WHERE ${where}
      GROUP BY l.id, i.sku, i.name, i.uom
      ORDER BY (l.expiry_date IS NULL), l.expiry_date, i.sku`,
    params,
  );
  return ok(rows.map((r) => ({ ...r, qty_on_hand: Number(r.qty_on_hand) })));
}

// Manually register a lot (put-away also auto-creates lots from a typed lot no.).
export async function POST(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  const itemId = dto.item_id as string;
  const lotNo = (dto.lot_no as string)?.trim();
  if (!companyId || !itemId || !lotNo) return err('company_id, item_id, lot_no are required', 400);

  try {
    const [lot] = await query(
      `INSERT INTO item_lots (company_id, item_id, lot_no, expiry_date)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (item_id, lot_no) DO UPDATE SET expiry_date = EXCLUDED.expiry_date
       RETURNING *`,
      [companyId, itemId, lotNo, (dto.expiry_date as string) || null],
    );
    return ok(lot, 201);
  } catch (e) { return err((e as Error).message ?? 'Failed to create lot', 500); }
}
