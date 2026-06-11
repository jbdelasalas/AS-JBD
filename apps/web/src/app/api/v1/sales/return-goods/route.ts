export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS return_goods (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      return_no    varchar(50) NOT NULL,
      dr_id        uuid NOT NULL REFERENCES delivery_receipts(id),
      dr_no        varchar(50),
      customer_id  uuid NOT NULL REFERENCES customers(id),
      customer_name text,
      return_date  date NOT NULL,
      reason       text,
      status       varchar(20) NOT NULL DEFAULT 'saved',
      je_id        uuid REFERENCES journal_entries(id),
      created_by   uuid REFERENCES users(id),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, return_no)
    )
  `, []).catch(() => {});
  await query(`
    CREATE TABLE IF NOT EXISTS return_goods_lines (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      return_id    uuid NOT NULL REFERENCES return_goods(id) ON DELETE CASCADE,
      dr_line_id   uuid,
      line_no      int NOT NULL,
      item_id      uuid NOT NULL REFERENCES items(id),
      description  text NOT NULL DEFAULT '',
      qty_return   numeric(14,4) NOT NULL DEFAULT 0,
      unit_cost    numeric(14,4) NOT NULL DEFAULT 0,
      unit_price   numeric(14,4) NOT NULL DEFAULT 0,
      vat_rate     numeric(5,2)  NOT NULL DEFAULT 0,
      discount_pct numeric(5,2)  NOT NULL DEFAULT 0,
      remarks      text
    )
  `, []).catch(() => {});
}

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  await ensureTables();
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `r.company_id = $1`;
  const status = searchParams.get('status');
  const drId   = searchParams.get('dr_id');
  if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }
  if (drId)   { params.push(drId);   where += ` AND r.dr_id  = $${params.length}`; }
  params.push(limit, offset);
  try {
    const rows = await query(
      `SELECT r.id, r.return_no, r.return_date, r.status, r.dr_no,
              r.customer_name, r.reason, r.created_at
         FROM return_goods r
        WHERE ${where}
        ORDER BY r.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const [{ c }] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM return_goods r WHERE ${where}`,
      params.slice(0, params.length - 2),
    );
    return ok({ data: rows, total: c });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  await ensureTables();
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  const drId      = dto.dr_id as string;
  if (!companyId || !drId || !dto.return_date) return err('company_id, dr_id, and return_date are required', 400);
  const lines = (dto.lines as Record<string, unknown>[]) ?? [];
  if (!lines.length) return err('At least one line is required', 400);

  const [dr] = await query<Record<string, unknown>>(
    `SELECT dr.*, c.name AS customer_name FROM delivery_receipts dr JOIN customers c ON c.id = dr.customer_id WHERE dr.id = $1`, [drId]);
  if (!dr) return err('DR not found', 404);
  if (dr.status !== 'posted') return err('Can only create returns from a posted DR', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Auto-seed series if missing
    await client.query(
      `INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number, is_active)
       SELECT $1, 'return_goods', 'RG-', 1, 0, true
       WHERE NOT EXISTS (SELECT 1 FROM document_series WHERE company_id = $1 AND doc_type = 'return_goods')`,
      [companyId],
    ).catch(() => {});
    const ser = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = 'return_goods' AND is_active = true RETURNING prefix, current_number`,
      [companyId],
    );
    if (!ser.rows[0]) { await client.query('ROLLBACK'); return err('No active series for return_goods', 400); }
    const returnNo = `${ser.rows[0].prefix}${String(ser.rows[0].current_number).padStart(6, '0')}`;

    const { rows: [hdr] } = await client.query(
      `INSERT INTO return_goods (company_id, return_no, dr_id, dr_no, customer_id, customer_name, return_date, reason, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'saved',$9) RETURNING *`,
      [companyId, returnNo, drId, dr.dr_no, dr.customer_id, dr.customer_name,
       dto.return_date, dto.reason ?? null, auth.userId],
    );

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO return_goods_lines (return_id, dr_line_id, line_no, item_id, description, qty_return, unit_cost, unit_price, vat_rate, discount_pct, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [hdr.id, l.dr_line_id ?? null, i + 1, l.item_id, l.description ?? '', l.qty_return ?? 0,
         l.unit_cost ?? 0, l.unit_price ?? 0, l.vat_rate ?? 0, l.discount_pct ?? 0, l.remarks ?? null],
      );
    }

    await client.query('COMMIT');
    return ok(hdr, 201);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
