export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  const [rec] = await query<{ status: string; company_id: string }>(`SELECT status, company_id FROM poultry_invoices WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status !== 'draft') return err(`Cannot post from status: ${rec.status}`, 400);
  await query(`UPDATE poultry_invoices SET status='posted', posted_by=$1, posted_at=now() WHERE id=$2`, [auth.userId, params.id]);
  await query(`INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'post','poultry_invoice',$3)`,
    [auth.userId, rec.company_id, params.id]).catch(() => {});
  const [updated] = await query(`SELECT * FROM poultry_invoices WHERE id = $1`, [params.id]);
  return ok(updated);
}
