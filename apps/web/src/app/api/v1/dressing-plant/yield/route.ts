export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Module B — Yield & WIP. recovery_pct is a generated column. On insert we run
// the mass-balance and recovery checks and surface any alerts in the response
// (unaccounted loss > 1.5% of live weight, or dressed/live < 75%).

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  const jobOrderId = searchParams.get('job_order_id');

  const params: unknown[] = [companyId];
  let where = `jo.company_id = $1`;
  if (jobOrderId) { params.push(jobOrderId); where += ` AND yr.job_order_id = $${params.length}`; }

  const rows = await query(
    `SELECT yr.id, yr.job_order_id, jo.batch_no, c.name AS client_name,
            yr.net_live_weight_kg, yr.dressed_recovery_weight_kg, yr.offal_weight_kg,
            yr.reject_condemned_weight_kg, yr.cutup_config, yr.recovery_pct, yr.created_at
       FROM dp_yield_records yr
       JOIN dp_job_orders jo ON jo.id = yr.job_order_id
       JOIN dp_clients c ON c.id = jo.client_id
      WHERE ${where}
      ORDER BY yr.created_at DESC`,
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
  const live = Number(dto.net_live_weight_kg);
  if (!(live > 0)) return err('net_live_weight_kg must be greater than 0', 400);

  const dressed = dto.dressed_recovery_weight_kg != null ? Number(dto.dressed_recovery_weight_kg) : null;
  const offal = dto.offal_weight_kg != null ? Number(dto.offal_weight_kg) : 0;
  const condemned = dto.reject_condemned_weight_kg != null ? Number(dto.reject_condemned_weight_kg) : 0;

  try {
    const [row] = await query<{ id: string; recovery_pct: number | null }>(
      `INSERT INTO dp_yield_records
         (job_order_id, net_live_weight_kg, dressed_recovery_weight_kg,
          offal_weight_kg, reject_condemned_weight_kg, cutup_config, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, recovery_pct`,
      [jobOrderId, live, dressed, offal, condemned, (dto.cutup_config as string) || null, auth.userId],
    );

    // Alerts (computed the same way the KPI dashboard does).
    const alerts: string[] = [];
    if (dressed != null) {
      const unaccounted = live - (dressed + offal + condemned);
      if (unaccounted > live * 0.015) {
        alerts.push(`Mass-balance variance: ${unaccounted.toFixed(2)} kg unaccounted (> 1.5% of live) — possible floor loss or scale error.`);
      }
      const recovery = row.recovery_pct != null ? Number(row.recovery_pct) : (dressed / live) * 100;
      if (recovery < 75) {
        alerts.push(`Low recovery: ${recovery.toFixed(1)}% (< 75%) — alert operations.`);
      }
    }

    return ok({ ...row, alerts }, 201);
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to record yield', 500);
  }
}
