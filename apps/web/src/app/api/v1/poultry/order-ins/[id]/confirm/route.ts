export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  const [rec] = await query<{ status: string; company_id: string }>(`SELECT status, company_id FROM order_ins WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status !== 'saved') return err(`Cannot confirm from status: ${rec.status}`, 400);
  await query(`UPDATE order_ins SET status='confirmed', confirmed_by=$1, confirmed_at=now() WHERE id=$2`, [auth.userId, params.id]);
  await query(`INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'confirm','order_in',$3)`,
    [auth.userId, rec.company_id, params.id]).catch(() => {});
  const [updated] = await query(`SELECT * FROM order_ins WHERE id = $1`, [params.id]);
  return ok(updated);
}
