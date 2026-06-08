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
  let where = `c.company_id = $1`;
  if (status) { params.push(status); where += ` AND c.status = $${params.length}`; }
  params.push(limit, offset);
  try {
    const rows = await query(
      `SELECT c.id, c.doc_no, c.transaction_date, c.status, c.source_heads, c.source_kgs, c.total_output_kgs, c.yield_pct,
              i.name AS source_item_name, i.sku AS source_sku
         FROM conversions c JOIN items i ON i.id = c.source_item_id
        WHERE ${where} ORDER BY c.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const [{ c }] = await query<{ c: number }>(`SELECT count(*)::int AS c FROM conversions c WHERE ${where}`, params.slice(0, params.length - 2));
    return ok({ data: rows, total: c });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  if (!companyId || !dto.source_item_id || !dto.transaction_date) return err('company_id, source_item_id, and transaction_date are required', 400);
  const outputs = (dto.outputs as Record<string, unknown>[]) ?? [];

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const ser = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = 'conversion' AND is_active = true RETURNING prefix, current_number`,
      [companyId],
    );
    if (!ser.rows[0]) { await client.query('ROLLBACK'); return err('No active series for conversion', 400); }
    const docNo = `${ser.rows[0].prefix}${String(ser.rows[0].current_number).padStart(6, '0')}`;
    const totalOut = outputs.reduce((s, o) => s + Number(o.kgs ?? 0), 0);
    const srcKgs = Number(dto.source_kgs ?? 0);
    const yieldPct = srcKgs > 0 ? parseFloat(((totalOut / srcKgs) * 100).toFixed(2)) : null;

    const orNull = (v: unknown) => (v as string) || null;
    const { rows: [hdr] } = await client.query(
      `INSERT INTO conversions (company_id, doc_no, branch_id, target_branch_id, po_id, transaction_date,
         tally_sheet_id, source_item_id, source_heads, source_kgs, doa_heads, doa_kgs,
         short_over_heads, short_over_kgs, remarks, status, total_output_kgs, yield_pct, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'saved',$16,$17,$18) RETURNING *`,
      [companyId, docNo, orNull(dto.branch_id), orNull(dto.target_branch_id), orNull(dto.po_id),
       dto.transaction_date, orNull(dto.tally_sheet_id), dto.source_item_id,
       dto.source_heads ?? 0, srcKgs,
       dto.doa_heads ?? 0, dto.doa_kgs ?? 0,
       dto.short_over_heads ?? 0, dto.short_over_kgs ?? 0,
       orNull(dto.remarks), totalOut, yieldPct, auth.userId],
    );
    // Ensure dressing_fee column exists (non-fatal DDL outside transaction)
    await query(`ALTER TABLE conversion_outputs ADD COLUMN IF NOT EXISTS dressing_fee numeric(15,4) NOT NULL DEFAULT 0`).catch(() => {});

    for (let i = 0; i < outputs.length; i++) {
      const o = outputs[i];
      const dressingFee = Number(o.dressing_fee ?? 0);
      await client.query(
        `INSERT INTO conversion_outputs (conversion_id, line_no, output_item_id, category, heads, kgs, unit_cost, dressing_fee, total_cost, delivery_ref_no, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [hdr.id, i + 1, o.output_item_id, o.category ?? null,
         o.heads ?? 0, o.kgs ?? 0, o.unit_cost ?? 0, dressingFee,
         Number(o.kgs ?? 0) * Number(o.unit_cost ?? 0) + dressingFee,
         o.delivery_ref_no ?? null, o.remarks ?? null],
      );
    }
    await client.query('COMMIT');
    return ok(hdr, 201);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
