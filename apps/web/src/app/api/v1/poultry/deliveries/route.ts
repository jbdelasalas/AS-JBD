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
  let where = `d.company_id = $1`;
  if (status) { params.push(status); where += ` AND d.status = $${params.length}`; }
  params.push(limit, offset);
  try {
    const rows = await query(
      `SELECT d.id, d.doc_no, d.transaction_date, d.commitment_date, d.status,
              d.total_heads, d.total_kgs, d.total_amount, d.delivery_method, d.plate_number,
              c.name AS customer_name, c.code AS customer_code
         FROM poultry_deliveries d JOIN customers c ON c.id = d.customer_id
        WHERE ${where} ORDER BY d.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const [{ c }] = await query<{ c: number }>(`SELECT count(*)::int AS c FROM poultry_deliveries d WHERE ${where}`, params.slice(0, params.length - 2));
    return ok({ data: rows.map(r => ({ ...r, total_amount: Number((r as Record<string,unknown>).total_amount) })), total: c });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  if (!companyId || !dto.customer_id || !dto.transaction_date) return err('company_id, customer_id, and transaction_date are required', 400);
  const lines = (dto.lines as Record<string, unknown>[]) ?? [];
  if (!lines.length) return err('At least one line is required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const ser = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = 'poultry_delivery' AND is_active = true RETURNING prefix, current_number`,
      [companyId],
    );
    if (!ser.rows[0]) { await client.query('ROLLBACK'); return err('No active series for poultry_delivery', 400); }
    const docNo = `${ser.rows[0].prefix}${String(ser.rows[0].current_number).padStart(6, '0')}`;

    const totHeads = lines.reduce((s, l) => s + Number(l.heads ?? 0), 0);
    const totKgs = lines.reduce((s, l) => s + Number(l.kgs ?? 0), 0);
    const totAmt = lines.reduce((s, l) => s + Number(l.kgs ?? 0) * Number(l.unit_price ?? 0) * (1 - Number(l.discount_pct ?? 0) / 100), 0);

    const { rows: [hdr] } = await client.query(
      `INSERT INTO poultry_deliveries (company_id, doc_no, customer_id, sales_tally_id, conversion_id, branch_id, warehouse_id,
         transaction_date, reference_no, delivery_method, delivery_address, commitment_date, plate_number, driver,
         remarks, status, total_heads, total_kgs, total_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'saved',$16,$17,$18,$19) RETURNING *`,
      [companyId, docNo, dto.customer_id, dto.sales_tally_id ?? null, dto.conversion_id ?? null,
       dto.branch_id ?? null, dto.warehouse_id ?? null, dto.transaction_date, dto.reference_no ?? null,
       dto.delivery_method ?? null, dto.delivery_address ?? null, dto.commitment_date ?? null,
       dto.plate_number ?? null, dto.driver ?? null, dto.remarks ?? null,
       totHeads, totKgs, totAmt, auth.userId],
    );
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const amt = Number(l.kgs ?? 0) * Number(l.unit_price ?? 0) * (1 - Number(l.discount_pct ?? 0) / 100);
      await client.query(
        `INSERT INTO poultry_delivery_lines (delivery_id, line_no, item_id, heads, kgs, unit_price, discount_pct, amount, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [hdr.id, i + 1, l.item_id, l.heads ?? 0, l.kgs ?? 0, l.unit_price ?? 0, l.discount_pct ?? 0, amt, l.remarks ?? null],
      );
    }
    await client.query('COMMIT');
    return ok(hdr, 201);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
