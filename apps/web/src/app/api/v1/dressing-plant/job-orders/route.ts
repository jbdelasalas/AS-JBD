export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Job orders = the batch. Everything downstream carries this id + client_id.
// Batch numbers are auto-allocated DP-<year>-<seq> per company.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `jo.company_id = $1`;
  const status = searchParams.get('status');
  if (status) { params.push(status); where += ` AND jo.status = $${params.length}`; }

  const rows = await query(
    `SELECT jo.id, jo.batch_no, jo.status, jo.received_at, jo.locked, jo.notes,
            jo.client_id, c.name AS client_name, c.code AS client_code,
            rw.net_live_weight_kg, rw.head_count, rw.doa_count,
            yr.recovery_pct, yr.dressed_recovery_weight_kg
       FROM dp_job_orders jo
       JOIN dp_clients c ON c.id = jo.client_id
       LEFT JOIN LATERAL (
         SELECT net_live_weight_kg, head_count, doa_count
           FROM dp_receiving_weights WHERE job_order_id = jo.id
           ORDER BY created_at DESC LIMIT 1
       ) rw ON true
       LEFT JOIN LATERAL (
         SELECT recovery_pct, dressed_recovery_weight_kg
           FROM dp_yield_records WHERE job_order_id = jo.id
           ORDER BY created_at DESC LIMIT 1
       ) yr ON true
      WHERE ${where}
      ORDER BY jo.received_at DESC`,
    params,
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.client_id) return err('client_id is required', 400);

  try {
    const [seq] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM dp_job_orders WHERE company_id = $1`,
      [companyId],
    );
    const year = new Date().getFullYear();
    const batchNo = (dto.batch_no as string) || `DP-${year}-${String(seq.c + 1).padStart(5, '0')}`;

    const [row] = await query<{ id: string; batch_no: string }>(
      `INSERT INTO dp_job_orders (company_id, branch_id, batch_no, client_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, batch_no`,
      [
        companyId,
        (dto.branch_id as string) || null,
        batchNo,
        dto.client_id,
        (dto.notes as string) || null,
        auth.userId,
      ],
    );
    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'create','dp_job_order',$3)`,
      [auth.userId, companyId, row.id],
    ).catch(() => {});
    return ok(row, 201);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'Failed to create job order';
    if (/unique|duplicate/i.test(msg)) return err('Batch number collision — please retry', 409);
    return err(msg, 500);
  }
}
