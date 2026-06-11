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
  let where = `t.company_id = $1`;
  const growCycleId = searchParams.get('grow_cycle_id');
  if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
  if (growCycleId) { params.push(growCycleId); where += ` AND t.grow_cycle_id = $${params.length}`; }
  params.push(limit, offset);
  try {
    const rows = await query(
      `SELECT t.id, t.doc_no, t.tally_type, t.transfer_date, t.status,
              t.harvested_heads, t.net_heads, t.net_kgs, t.plate_number, t.driver,
              t.received_by, t.created_at,
              g.doc_no AS grow_cycle_no
         FROM tally_sheets t
         LEFT JOIN grow_cycles g ON g.id = t.grow_cycle_id
        WHERE ${where} ORDER BY t.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const [{ c }] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM tally_sheets t WHERE ${where}`,
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
  if (!companyId || !dto.transfer_date) return err('company_id and transfer_date are required', 400);
  const lines = (dto.lines as Record<string, unknown>[]) ?? [];

  // Ensure live_item_id column exists (added post-initial schema)
  await query(`ALTER TABLE tally_sheets ADD COLUMN IF NOT EXISTS live_item_id uuid REFERENCES items(id)`, []).catch(() => {});

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const ser = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = 'tally_sheet' AND is_active = true RETURNING prefix, current_number`,
      [companyId],
    );
    if (!ser.rows[0]) { await client.query('ROLLBACK'); return err('No active series for tally_sheet', 400); }
    const docNo = `${ser.rows[0].prefix}${String(ser.rows[0].current_number).padStart(6, '0')}`;

    const netHeads = lines.reduce((s, l) => s + Number(l.heads ?? 0), 0);
    const netKgs = lines.reduce((s, l) => s + Number(l.net_kgs ?? 0), 0);

    const orNull = (v: unknown) => (v as string) || null;

    // Pull live_item_id from the grow cycle so the transfer JE route can use it
    let gcLiveItemId: string | null = orNull(dto.live_item_id);
    if (!gcLiveItemId && dto.grow_cycle_id) {
      const gcRow = await client.query<{ live_item_id: string | null }>(
        `SELECT live_item_id FROM grow_cycles WHERE id = $1 LIMIT 1`, [dto.grow_cycle_id]);
      gcLiveItemId = gcRow.rows[0]?.live_item_id ?? null;
    }
    const { rows: [hdr] } = await client.query(
      `INSERT INTO tally_sheets (company_id, doc_no, tally_type, grow_cycle_id, supplier_id, destination_id,
         transfer_date, reference_id, harvested_heads, reject_kgs, reject_heads, replacement_kgs, replacement_heads,
         net_heads, net_kgs, received_by, issued_by, checked_by, delivery_method, plate_number, driver, helper,
         start_time, end_time, remarks, branch_id, building_id, cost_center_id, grow_reference_id, live_item_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,'saved',$31) RETURNING *`,
      [companyId, docNo, dto.tally_type ?? 'harvest', orNull(dto.grow_cycle_id), orNull(dto.supplier_id),
       orNull(dto.destination_id), dto.transfer_date, orNull(dto.reference_id),
       dto.harvested_heads ?? netHeads, dto.reject_kgs ?? 0, dto.reject_heads ?? 0,
       dto.replacement_kgs ?? 0, dto.replacement_heads ?? 0, netHeads, netKgs,
       orNull(dto.received_by), orNull(dto.issued_by), orNull(dto.checked_by),
       orNull(dto.delivery_method), orNull(dto.plate_number), orNull(dto.driver), orNull(dto.helper),
       orNull(dto.start_time), orNull(dto.end_time), orNull(dto.remarks),
       orNull(dto.branch_id), orNull(dto.building_id), orNull(dto.cost_center_id), orNull(dto.grow_reference_id),
       gcLiveItemId, auth.userId],
    );
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO tally_sheet_lines (tally_sheet_id, line_no, item_id, heads, gross_kgs, crate_kgs, net_kgs, avg_weight, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [hdr.id, i + 1, l.item_id, l.heads ?? 0, l.gross_kgs ?? 0, l.crate_kgs ?? 0, l.net_kgs ?? 0,
         Number(l.heads ?? 0) > 0 ? Number(l.net_kgs ?? 0) / Number(l.heads) : 0, l.remarks ?? null],
      );
    }
    await client.query('COMMIT');
    return ok(hdr, 201);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
