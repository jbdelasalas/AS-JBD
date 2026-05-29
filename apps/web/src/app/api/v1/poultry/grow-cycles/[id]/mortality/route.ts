export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const [cycle] = await query<{ status: string; heads_available: number; company_id: string }>(
    `SELECT status, heads_available, company_id FROM grow_cycles WHERE id = $1`, [params.id]);
  if (!cycle) return err('Not found', 404);
  if (cycle.status !== 'active' && cycle.status !== 'harvesting') return err('Grow cycle is not active', 400);

  const heads = Number(dto.heads ?? 0);
  if (heads <= 0) return err('heads must be > 0', 400);
  if (heads > cycle.heads_available) return err('Mortality exceeds available heads', 400);

  await query(
    `INSERT INTO grow_mortality_logs (grow_cycle_id, log_date, heads, cause, recorded_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.id, dto.log_date ?? new Date().toISOString().split('T')[0], heads, dto.cause ?? null, auth.userId],
  );
  await query(
    `UPDATE grow_cycles SET total_mortality = total_mortality + $1, heads_available = heads_available - $1 WHERE id = $2`,
    [heads, params.id],
  );
  const [updated] = await query(`SELECT * FROM grow_cycles WHERE id = $1`, [params.id]);
  return ok(updated);
}
