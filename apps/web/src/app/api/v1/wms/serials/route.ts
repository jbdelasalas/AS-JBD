export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `s.company_id = $1`;
  const itemId = searchParams.get('item_id');
  if (itemId) { params.push(itemId); where += ` AND s.item_id = $${params.length}`; }
  const status = searchParams.get('status');
  if (status && status !== 'all') { params.push(status); where += ` AND s.status = $${params.length}`; }
  const search = searchParams.get('search');
  if (search) { params.push(`%${search}%`); where += ` AND (s.serial_no ILIKE $${params.length} OR i.sku ILIKE $${params.length})`; }

  const rows = await query(
    `SELECT s.id, s.serial_no, s.status, s.received_at, s.shipped_at,
            i.sku, i.name AS item_name, w.name AS warehouse_name, b.code AS bin_code, l.lot_no
       FROM item_serials s
       JOIN items i ON i.id = s.item_id
       LEFT JOIN warehouses w ON w.id = s.warehouse_id
       LEFT JOIN bins b ON b.id = s.bin_id
       LEFT JOIN item_lots l ON l.id = s.lot_id
      WHERE ${where}
      ORDER BY i.sku, s.serial_no
      LIMIT 1000`,
    params,
  );
  return ok(rows);
}

// Register serial units (one row each) into a warehouse/bin.
export async function POST(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  const itemId = dto.item_id as string;
  const serials = (dto.serial_nos as string[] | undefined)?.map((x) => x.trim()).filter(Boolean) ?? [];
  if (!companyId || !itemId) return err('company_id and item_id are required', 400);
  if (!serials.length) return err('At least one serial number is required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;
    for (const sn of serials) {
      const res = await client.query(
        `INSERT INTO item_serials (company_id, item_id, serial_no, lot_id, warehouse_id, bin_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,'in_stock')
         ON CONFLICT (item_id, serial_no) DO NOTHING`,
        [companyId, itemId, sn, dto.lot_id ?? null, dto.warehouse_id ?? null, dto.bin_id ?? null],
      );
      inserted += res.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return ok({ inserted, skipped: serials.length - inserted }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to register serials', 500);
  } finally { client.release(); }
}
