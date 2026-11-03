export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Batch-level entries for the dressing-plant reports: receiving complete/reopen,
// harvest date, plant checker and the Basic Production Report's typed extras
// (packaging, trimmings, ice, manpower, prepared by).
//
// GET  ?job_order_id=  → batch header, trucks and production lines for the reports
// PUT  { job_order_id, receiving_complete?, harvest_date?, plant_checker?, report_extras? }

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const id = new URL(request.url).searchParams.get('job_order_id');
  if (!id) return err('job_order_id is required', 400);

  const [job] = await query(
    `SELECT jo.id, jo.batch_no, jo.status, jo.received_at, jo.receiving_completed_at, jo.farm_location,
            to_char(jo.harvest_date, 'YYYY-MM-DD') AS harvest_date, jo.plant_checker, jo.report_extras,
            c.name AS client_name,
            (SELECT to_char(MIN(po.created_at), 'YYYY-MM-DD') FROM dp_processed_output po WHERE po.job_order_id = jo.id) AS production_date
       FROM dp_job_orders jo JOIN dp_clients c ON c.id = jo.client_id
      WHERE jo.id = $1`,
    [id],
  );
  if (!job) return err('Batch not found', 404);

  const trucks = await query(
    `SELECT rw.seq, rw.plate_no, rw.seal_no, rw.farm_name, rw.farm_address, rw.house_no,
            rw.farm_count, rw.farm_weight_kg, rw.net_live_weight_kg, rw.coop_count, rw.head_count,
            rw.doa_count, rw.doa_weight_kg,
            to_char(rw.farm_departure, 'HH24:MI') AS farm_departure, to_char(rw.plant_arrival, 'HH24:MI') AS plant_arrival,
            to_char(rw.start_hang, 'HH24:MI') AS start_hang, to_char(rw.end_hang, 'HH24:MI') AS end_hang
       FROM dp_receiving_weights rw WHERE rw.job_order_id = $1
      ORDER BY rw.seq, rw.received_at`,
    [id],
  );

  // Production per item, with the item's category to split by-products from dressed output.
  const lines = await query(
    `SELECT i.name AS item_name, COALESCE(cat.name, '') AS category,
            SUM(po.pack_count)::int AS packs, SUM(po.head_count)::int AS heads, SUM(po.weight_kg) AS weight_kg
       FROM dp_processed_output po
       JOIN items i ON i.id = po.item_id
       LEFT JOIN item_categories cat ON cat.id = i.category_id
      WHERE po.job_order_id = $1
      GROUP BY i.name, cat.name`,
    [id],
  );

  return ok({ job, trucks, lines });
}

export async function PUT(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }
  const id = dto.job_order_id as string;
  if (!id) return err('job_order_id is required', 400);

  const sets: string[] = [];
  const params: unknown[] = [id];
  if (dto.receiving_complete !== undefined) {
    if (dto.receiving_complete) {
      const [n] = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM dp_receiving_weights WHERE job_order_id = $1`, [id]);
      if (!n?.n) return err('Record at least one truck before completing receiving', 400);
    }
    sets.push(`receiving_completed_at = ${dto.receiving_complete ? 'now()' : 'NULL'}`);
  }
  if (dto.harvest_date !== undefined) { params.push(dto.harvest_date || null); sets.push(`harvest_date = $${params.length}::date`); }
  if (dto.plant_checker !== undefined) { params.push(dto.plant_checker || null); sets.push(`plant_checker = $${params.length}::text`); }
  if (dto.report_extras !== undefined) { params.push(JSON.stringify(dto.report_extras ?? {})); sets.push(`report_extras = $${params.length}::jsonb`); }
  if (!sets.length) return err('Nothing to update', 400);

  const rows = await query(`UPDATE dp_job_orders SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`, params);
  if (!rows.length) return err('Batch not found', 404);
  return ok({ updated: true });
}
