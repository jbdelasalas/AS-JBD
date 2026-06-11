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
  let where = `s.company_id = $1`;
  if (status) { params.push(status); where += ` AND s.status = $${params.length}`; }
  params.push(limit, offset);
  try {
    // sales_tally_sheets is shared by two subsystems with different column
    // shapes: this dispatch flow (doc_no / transfer_date) and the allocation
    // flow (tally_no / tally_date). COALESCE so rows from either flow render.
    const rows = await query(
      `SELECT s.id,
              COALESCE(s.doc_no, s.tally_no)                AS doc_no,
              COALESCE(s.transfer_date, s.tally_date)       AS transfer_date,
              s.status, s.ref_no, s.delivery_ref_no, s.plate_number, s.driver,
              COALESCE(c.name, s.customer_name)             AS customer_name,
              c.code                                        AS customer_code
         FROM sales_tally_sheets s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE ${where} ORDER BY s.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const [{ c }] = await query<{ c: number }>(`SELECT count(*)::int AS c FROM sales_tally_sheets s WHERE ${where}`, params.slice(0, params.length - 2));
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
        WHERE company_id = $1 AND doc_type = 'sales_tally' AND is_active = true RETURNING prefix, current_number`,
      [companyId],
    );
    if (!ser.rows[0]) { await client.query('ROLLBACK'); return err('No active series for sales_tally', 400); }
    const docNo = `${ser.rows[0].prefix}${String(ser.rows[0].current_number).padStart(6, '0')}`;

    const { rows: [hdr] } = await client.query(
      `INSERT INTO sales_tally_sheets (company_id, doc_no, customer_id, branch_id, transfer_date, ref_no, delivery_ref_no,
         received_by, issued_by, checked_by, start_time, end_time, delivery_method, plate_number, driver, remarks, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'saved',$17) RETURNING *`,
      [companyId, docNo, dto.customer_id ?? null, dto.branch_id ?? null, dto.transfer_date,
       dto.ref_no ?? null, dto.delivery_ref_no ?? null, dto.received_by ?? null,
       dto.issued_by ?? null, dto.checked_by ?? null, dto.start_time ?? null, dto.end_time ?? null,
       dto.delivery_method ?? null, dto.plate_number ?? null, dto.driver ?? null, dto.remarks ?? null, auth.userId],
    );
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const amt = Number(l.net_kgs ?? 0) * Number(l.unit_price ?? 0);
      await client.query(
        `INSERT INTO sales_tally_lines (sales_tally_id, line_no, item_id, heads, gross_kgs, crate_kgs, net_kgs, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [hdr.id, i + 1, l.item_id, l.heads ?? 0, l.gross_kgs ?? 0, l.crate_kgs ?? 0, l.net_kgs ?? 0, l.unit_price ?? 0, amt],
      );
    }
    await client.query('COMMIT');
    return ok(hdr, 201);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
