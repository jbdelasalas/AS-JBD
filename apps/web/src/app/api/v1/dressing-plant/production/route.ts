export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Processed-chicken production detail — per product (ERP item) and per size,
// scoped to a batch. GET lists the lines for a batch; POST replaces the batch's
// lines with the submitted set (simple, predictable editing).

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  const jobOrderId = searchParams.get('job_order_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `po.company_id = $1`;
  if (jobOrderId) { params.push(jobOrderId); where += ` AND po.job_order_id = $${params.length}`; }

  const rows = await query(
    `SELECT po.id, po.job_order_id, jo.batch_no, po.item_id, i.name AS item_name, i.sku,
            po.size_id, s.code AS size_code, s.name AS size_name,
            po.pack_count, po.head_count, po.weight_kg,
            po.transferred_kg, po.transferred_at
       FROM dp_processed_output po
       JOIN dp_job_orders jo ON jo.id = po.job_order_id
       JOIN items i ON i.id = po.item_id
       LEFT JOIN dp_sizes s ON s.id = po.size_id
      WHERE ${where}
      ORDER BY po.line_no NULLS LAST, po.created_at, i.name`,
    params,
  );
  return ok({ data: rows });
}

interface Line {
  item_id: string;
  size_id?: string | null;
  pack_count?: number;
  head_count?: number;
  weight_kg?: number;
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  const jobOrderId = dto.job_order_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!jobOrderId) return err('job_order_id is required', 400);
  const lines = Array.isArray(dto.lines) ? (dto.lines as Line[]) : [];

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Packs on a draft put-away can't be rewritten (saving replaces the lines).
    const { rows: [held] } = await client.query(
      `SELECT p.putaway_no FROM putaway_lines pl JOIN putaways p ON p.id = pl.putaway_id
         JOIN dp_processed_output po ON po.id = pl.dp_output_id
        WHERE po.job_order_id = $1 AND p.status = 'draft' LIMIT 1`,
      [jobOrderId],
    );
    if (held) {
      await client.query('ROLLBACK');
      return err(`Packs of this batch are on draft put-away ${held.putaway_no} — post or cancel it before changing production lines`, 409);
    }
    // Preserve already-transferred lines; only replace the untransferred ones.
    await client.query(
      `DELETE FROM dp_processed_output
        WHERE job_order_id = $1 AND (transferred_kg IS NULL OR transferred_kg = 0)`,
      [jobOrderId],
    );
    const keep = lines
      .map((l) => ({ ...l, weight: Number(l.weight_kg ?? 0), packs: Number(l.pack_count ?? 0), heads: Number(l.head_count ?? 0) }))
      .filter((l) => l.item_id && (l.weight > 0 || l.packs > 0 || l.heads > 0));
    // One statement for all lines — an uploaded weighing file is hundreds of
    // lines, and a round trip per line made saving crawl.
    if (keep.length) {
      await client.query(
        `INSERT INTO dp_processed_output
           (company_id, job_order_id, item_id, size_id, pack_count, head_count, weight_kg, created_by, line_no)
         SELECT $1, $2, x.item_id, x.size_id, x.packs, x.heads, x.weight, $8,
                x.ord + (SELECT COALESCE(MAX(line_no), 0) FROM dp_processed_output WHERE job_order_id = $2)
           FROM unnest($3::uuid[], $4::uuid[], $5::numeric[], $6::numeric[], $7::numeric[]) WITH ORDINALITY
                AS x(item_id, size_id, packs, heads, weight, ord)`,
        [companyId, jobOrderId, keep.map((l) => l.item_id), keep.map((l) => l.size_id || null),
          keep.map((l) => l.packs), keep.map((l) => l.heads), keep.map((l) => l.weight), auth.userId],
      );
    }
    await client.query('COMMIT');
    return ok({ job_order_id: jobOrderId, lines: keep.length }, 201);
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to save production detail', 500);
  } finally {
    client.release();
  }
}
