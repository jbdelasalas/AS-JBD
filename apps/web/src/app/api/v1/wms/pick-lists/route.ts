export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { nextDocNo } from '@/lib/wms';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `p.company_id = $1`;
  const status = searchParams.get('status');
  if (status && status !== 'all') { params.push(status); where += ` AND p.status = $${params.length}`; }

  const rows = await query(
    `SELECT p.id, p.pick_no, p.status, p.created_at, p.picked_at, p.packed_at, p.notes,
            w.name AS warehouse_name, so.order_no
       FROM pick_lists p
       JOIN warehouses w ON w.id = p.warehouse_id
       LEFT JOIN sales_orders so ON so.id = p.so_id
      WHERE ${where}
      ORDER BY p.created_at DESC
      LIMIT 500`,
    params,
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const companyId = dto.company_id as string;
  const warehouseId = dto.warehouse_id as string;
  const lines = dto.lines as Array<Record<string, unknown>>;
  if (!companyId || !warehouseId) return err('company_id and warehouse_id are required', 400);
  if (!lines?.length) return err('At least one line required', 400);
  for (const l of lines) {
    if (!l.item_id || !l.bin_id || !(Number(l.qty_to_pick) > 0)) return err('Each line needs item, bin, and positive qty', 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const pickNo = await nextDocNo(client, companyId, 'pick_lists', 'pick_no', 'PCK');
    const { rows: [header] } = await client.query(
      `INSERT INTO pick_lists (company_id, pick_no, so_id, warehouse_id, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'draft',$6) RETURNING *`,
      [companyId, pickNo, dto.so_id ?? null, warehouseId, dto.notes ?? null, auth.userId],
    );
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO pick_list_lines (pick_id, line_no, item_id, bin_id, lot_id, qty_to_pick)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [header.id, i + 1, l.item_id, l.bin_id, l.lot_id ?? null, Number(l.qty_to_pick)],
      );
    }
    await client.query('COMMIT');
    return ok(header, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to create pick list', 500);
  } finally { client.release(); }
}
