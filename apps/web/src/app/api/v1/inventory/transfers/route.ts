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

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `st.company_id = $1`;

  const status = searchParams.get('status');
  if (status) { params.push(status); where += ` AND st.status = $${params.length}`; }
  params.push(limit, offset);

  const rows = await query(
    `SELECT st.id, st.transfer_no, st.status, st.created_at, st.sent_at, st.received_at, st.notes,
            fw.name AS from_warehouse_name, tw.name AS to_warehouse_name
       FROM stock_transfers st
       JOIN warehouses fw ON fw.id = st.from_warehouse_id
       JOIN warehouses tw ON tw.id = st.to_warehouse_id
      WHERE ${where}
      ORDER BY st.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM stock_transfers st WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({ data: rows, total: countRows[0].c });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const companyId = dto.company_id as string;
  const fromWarehouseId = dto.from_warehouse_id as string;
  const toWarehouseId = dto.to_warehouse_id as string;
  const lines = dto.lines as Array<Record<string, unknown>>;

  if (!companyId || !fromWarehouseId || !toWarehouseId) return err('company_id, from_warehouse_id, to_warehouse_id required', 400);
  if (fromWarehouseId === toWarehouseId) return err('From and To warehouses must differ', 400);
  if (!lines?.length) return err('At least one line required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM stock_transfers WHERE company_id = $1`,
      [companyId],
    );
    const transferNo = `TRF-${new Date().getFullYear()}-${String(seqRows.rows[0].c + 1).padStart(6, '0')}`;

    const headerRows = await client.query(
      `INSERT INTO stock_transfers (company_id, transfer_no, from_warehouse_id, to_warehouse_id, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'draft',$6) RETURNING *`,
      [companyId, transferNo, fromWarehouseId, toWarehouseId, dto.notes ?? null, auth.userId],
    );
    const header = headerRows.rows[0];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO stock_transfer_lines (transfer_id, line_no, item_id, qty) VALUES ($1,$2,$3,$4)`,
        [header.id, i + 1, l.item_id, Number(l.qty)],
      );
    }

    await client.query('COMMIT');

    const full = await query(
      `SELECT st.*, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name
         FROM stock_transfers st
         JOIN warehouses fw ON fw.id = st.from_warehouse_id
         JOIN warehouses tw ON tw.id = st.to_warehouse_id
        WHERE st.id = $1 LIMIT 1`,
      [header.id],
    );
    const tLines = await query(
      `SELECT stl.*, i.sku, i.name AS item_name, i.uom FROM stock_transfer_lines stl
       JOIN items i ON i.id = stl.item_id WHERE stl.transfer_id = $1 ORDER BY stl.line_no`,
      [header.id],
    );
    return ok({ ...full[0], lines: tLines }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
