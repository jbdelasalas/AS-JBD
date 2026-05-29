export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  const [rec] = await query<{ status: string; company_id: string }>(`SELECT status, company_id FROM inventory_ins WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status === 'voided') return err('Already voided', 400);
  if (rec.status === 'posted') {
    const used = await query(`SELECT id FROM chick_batches WHERE inventory_in_id = $1 AND status != 'available' LIMIT 1`, [params.id]);
    if (used.length) return err('Cannot void: chick batches from this receipt are already in use', 400);
  }
  await query(`UPDATE inventory_ins SET status='voided' WHERE id=$1`, [params.id]);
  await query(`UPDATE chick_batches SET status='closed' WHERE inventory_in_id=$1`, [params.id]);
  await query(`INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'void','inventory_in',$3)`,
    [auth.userId, rec.company_id, params.id]).catch(() => {});
  const [updated] = await query(`SELECT * FROM inventory_ins WHERE id = $1`, [params.id]);
  return ok(updated);
}
