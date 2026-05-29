export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  const [rec] = await query<{ status: string; company_id: string }>(`SELECT status, company_id FROM poultry_deliveries WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status === 'voided') return err('Already voided', 400);
  if (rec.status === 'posted') return err('Cannot void a posted delivery. Contact admin.', 400);
  await query(`UPDATE poultry_deliveries SET status='voided' WHERE id=$1`, [params.id]);
  await query(`INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'void','poultry_delivery',$3)`,
    [auth.userId, rec.company_id, params.id]).catch(() => {});
  const [updated] = await query(`SELECT * FROM poultry_deliveries WHERE id = $1`, [params.id]);
  return ok(updated);
}
