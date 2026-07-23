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
      ORDER BY i.name, s.sort_order`,
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
    // Preserve already-transferred lines; only replace the untransferred ones.
    await client.query(
      `DELETE FROM dp_processed_output
        WHERE job_order_id = $1 AND (transferred_kg IS NULL OR transferred_kg = 0)`,
      [jobOrderId],
    );
    let inserted = 0;
    for (const l of lines) {
      if (!l.item_id) continue;
      const weight = Number(l.weight_kg ?? 0);
      const packs = Number(l.pack_count ?? 0);
      const heads = Number(l.head_count ?? 0);
      if (weight <= 0 && packs <= 0 && heads <= 0) continue;
      await client.query(
        `INSERT INTO dp_processed_output
           (company_id, job_order_id, item_id, size_id, pack_count, head_count, weight_kg, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [companyId, jobOrderId, l.item_id, l.size_id || null, packs, heads, weight, auth.userId],
      );
      inserted += 1;
    }
    await client.query('COMMIT');
    return ok({ job_order_id: jobOrderId, lines: inserted }, 201);
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to save production detail', 500);
  } finally {
    client.release();
  }
}
