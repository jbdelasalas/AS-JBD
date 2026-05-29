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
  const status = searchParams.get('status');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `g.company_id = $1`;
  if (status) { params.push(status); where += ` AND g.status = $${params.length}`; }
  params.push(limit, offset);
  try {
    const rows = await query(
      `SELECT g.id, g.doc_no, g.year, g.start_date, g.expected_end_date, g.status,
              g.heads_in, g.total_mortality, g.heads_available, g.heads_harvested,
              g.est_harvest_recovery, b.batch_no, b.date_received,
              i.name AS item_name, fb.name AS building_name, fb.code AS building_code
         FROM grow_cycles g
         JOIN chick_batches b ON b.id = g.batch_id
         JOIN items i ON i.id = b.item_id
         LEFT JOIN farm_buildings fb ON fb.id = g.building_id
        WHERE ${where} ORDER BY g.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const [{ c }] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM grow_cycles g WHERE ${where}`,
      params.slice(0, params.length - 2),
    );
    return ok({ data: rows, total: c });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  if (!companyId || !dto.batch_id || !dto.start_date)
    return err('company_id, batch_id, and start_date are required', 400);

  const [batch] = await query<{ heads_available: number; status: string }>(
    `SELECT heads_available, status FROM chick_batches WHERE id = $1 AND company_id = $2`, [dto.batch_id, companyId]);
  if (!batch) return err('Chick batch not found', 404);
  if (batch.status !== 'available') return err('Chick batch is not available', 400);

  const heads = Number(dto.heads ?? batch.heads_available);
  if (heads > batch.heads_available) return err('Heads exceed available batch quantity', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const ser = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = 'grow_cycle' AND is_active = true RETURNING prefix, current_number`,
      [companyId],
    );
    if (!ser.rows[0]) { await client.query('ROLLBACK'); return err('No active series for grow_cycle', 400); }
    const docNo = `${ser.rows[0].prefix}${String(ser.rows[0].current_number).padStart(6, '0')}`;
    const year = new Date(dto.start_date as string).getFullYear();

    const { rows: [hdr] } = await client.query(
      `INSERT INTO grow_cycles (company_id, doc_no, year, branch_id, building_id, batch_id, heads_in, heads_available,
         start_date, expected_end_date, est_harvest_recovery, grow_reference, approx_heads,
         chick_price_per_head, approx_chick_price_per_head, status, remarks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15,$16) RETURNING *`,
      [companyId, docNo, year, dto.branch_id ?? null, dto.building_id ?? null, dto.batch_id,
       heads, dto.start_date, dto.expected_end_date ?? null, dto.est_harvest_recovery ?? null,
       dto.grow_reference ?? null, dto.approx_heads ?? heads,
       dto.chick_price_per_head ?? 0, dto.approx_chick_price_per_head ?? 0,
       dto.remarks ?? null, auth.userId],
    );
    await client.query(`UPDATE chick_batches SET status='in_growing', heads_available=heads_available-$1 WHERE id=$2`, [heads, dto.batch_id]);
    await client.query('COMMIT');
    return ok(hdr, 201);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
