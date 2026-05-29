export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT g.*, b.batch_no, b.date_received, b.heads_in AS batch_heads_in,
              i.name AS item_name, i.sku,
              fb.name AS building_name, fb.code AS building_code
         FROM grow_cycles g
         JOIN chick_batches b ON b.id = g.batch_id
         JOIN items i ON i.id = b.item_id
         LEFT JOIN farm_buildings fb ON fb.id = g.building_id
        WHERE g.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const mortality = await query(
      `SELECT * FROM grow_mortality_logs WHERE grow_cycle_id = $1 ORDER BY log_date DESC`, [params.id]);
    return ok({ ...hdr, mortality_logs: mortality });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
