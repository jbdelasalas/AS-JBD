export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query<Record<string, unknown>>(
      `SELECT r.*, dr.delivery_date AS dr_delivery_date
         FROM return_goods r
         LEFT JOIN delivery_receipts dr ON dr.id = r.dr_id
        WHERE r.id = $1 LIMIT 1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const lines = await query<Record<string, unknown>>(
      `SELECT l.*, i.name AS item_name, i.sku AS item_sku
         FROM return_goods_lines l
         JOIN items i ON i.id = l.item_id
        WHERE l.return_id = $1 ORDER BY l.line_no`, [params.id]);
    return ok({ ...hdr, lines });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
