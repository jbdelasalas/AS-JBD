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
  if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
  params.push(limit, offset);
  try {
    const rows = await query(
      `SELECT t.id, t.doc_no, t.tally_type, t.transfer_date, t.status,
              t.harvested_heads, t.net_heads, t.net_kgs, t.plate_number, t.driver,
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

    const { rows: [hdr] } = await client.query(
      `INSERT INTO tally_sheets (company_id, doc_no, tally_type, grow_cycle_id, supplier_id, destination_id, warehouse_id,
         transfer_date, reference_id, harvested_heads, reject_kgs, reject_heads, replacement_kgs, replacement_heads,
         net_heads, net_kgs, received_by, issued_by, checked_by, delivery_method, plate_number, driver, helper,
         start_time, end_time, remarks, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'saved',$27) RETURNING *`,
      [companyId, docNo, dto.tally_type ?? 'harvest', dto.grow_cycle_id ?? null, dto.supplier_id ?? null,
       dto.destination_id ?? null, dto.warehouse_id ?? null, dto.transfer_date, dto.reference_id ?? null,
       dto.harvested_heads ?? netHeads, dto.reject_kgs ?? 0, dto.reject_heads ?? 0,
       dto.replacement_kgs ?? 0, dto.replacement_heads ?? 0, netHeads, netKgs,
       dto.received_by ?? null, dto.issued_by ?? null, dto.checked_by ?? null,
       dto.delivery_method ?? null, dto.plate_number ?? null, dto.driver ?? null, dto.helper ?? null,
       dto.start_time ?? null, dto.end_time ?? null, dto.remarks ?? null, auth.userId],
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
