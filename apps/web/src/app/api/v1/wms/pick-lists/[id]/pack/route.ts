export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const [pl] = await query(`SELECT status FROM pick_lists WHERE id = $1 LIMIT 1`, [params.id]);
  if (!pl) return err('Pick list not found', 404);
  if (pl.status !== 'picked') return err('Pick list must be picked before packing', 400);

  const [updated] = await query(
    `UPDATE pick_lists SET status='packed', packed_at=now(), packed_by=$1, updated_at=now()
     WHERE id=$2 RETURNING *`,
    [auth.userId, params.id],
  );
  return ok(updated);
}
