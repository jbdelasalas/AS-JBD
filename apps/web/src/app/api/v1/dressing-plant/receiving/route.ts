export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Module A — Receiving & Weighing. Recording receiving fires a DB trigger that
// locks the batch (no journal entry here). net_live_weight_kg is a generated
// column (gross - tare).

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  const jobOrderId = searchParams.get('job_order_id');

  const params: unknown[] = [companyId];
  let where = `jo.company_id = $1`;
  if (jobOrderId) { params.push(jobOrderId); where += ` AND rw.job_order_id = $${params.length}`; }

  const rows = await query(
    `SELECT rw.id, rw.job_order_id, jo.batch_no, c.name AS client_name,
            rw.gross_weight_kg, rw.tare_weight_kg, rw.net_live_weight_kg,
            rw.coop_count, rw.head_count, rw.doa_count, rw.received_at
       FROM dp_receiving_weights rw
       JOIN dp_job_orders jo ON jo.id = rw.job_order_id
       JOIN dp_clients c ON c.id = jo.client_id
      WHERE ${where}
      ORDER BY rw.received_at DESC`,
    params,
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const jobOrderId = dto.job_order_id as string;
  if (!jobOrderId) return err('job_order_id is required', 400);
  const gross = Number(dto.gross_weight_kg);
  if (!(gross > 0)) return err('gross_weight_kg must be greater than 0', 400);
  const headCount = Number(dto.head_count);
  if (!(headCount > 0)) return err('head_count must be greater than 0', 400);

  try {
    const [row] = await query<{ id: string }>(
      `INSERT INTO dp_receiving_weights
         (job_order_id, gross_weight_kg, tare_weight_kg, coop_count, head_count, doa_count, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        jobOrderId,
        gross,
        dto.tare_weight_kg != null ? Number(dto.tare_weight_kg) : 0,
        dto.coop_count != null ? Number(dto.coop_count) : 0,
        headCount,
        dto.doa_count != null ? Number(dto.doa_count) : 0,
        auth.userId,
      ],
    );
    return ok(row, 201);
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to record receiving', 500);
  }
}
