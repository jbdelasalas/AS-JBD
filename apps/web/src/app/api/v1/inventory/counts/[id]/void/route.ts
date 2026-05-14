export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(`SELECT status FROM stock_counts WHERE id = $1 LIMIT 1`, [params.id]);
  if (!rows[0]) return err('Not found', 404);
  if (!['in_progress', 'draft'].includes(rows[0].status as string)) {
    return err('Only draft or in_progress counts can be voided', 400);
  }

  await query(
    `UPDATE stock_counts SET status='voided', updated_at=now() WHERE id=$1`, [params.id],
  );

  const updated = await query(`SELECT * FROM stock_counts WHERE id = $1 LIMIT 1`, [params.id]);
  return ok(updated[0]);
}
