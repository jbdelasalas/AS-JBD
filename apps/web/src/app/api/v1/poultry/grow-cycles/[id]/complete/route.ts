export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  const [cycle] = await query<{ status: string }>(
    `SELECT status FROM grow_cycles WHERE id = $1`, [params.id]);
  if (!cycle) return err('Not found', 404);
  if (cycle.status === 'completed' || cycle.status === 'closed') return err('Already completed', 400);
  await query(
    `UPDATE grow_cycles SET status='completed', actual_end_date=CURRENT_DATE WHERE id=$1`, [params.id]);
  const [updated] = await query(`SELECT * FROM grow_cycles WHERE id = $1`, [params.id]);
  return ok(updated);
}
