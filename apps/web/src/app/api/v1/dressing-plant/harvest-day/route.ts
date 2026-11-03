export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Live Harvest Report for a whole day: every truck of every batch harvested that
// day. Harvest day = the batch's harvest date, or the truck's receiving date
// (Manila time) when the batch has none.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  const date = searchParams.get('date');
  if (!companyId || !date) return err('company_id and date are required', 400);

  const trucks = await query(
    `SELECT jo.batch_no, rw.seq, rw.plate_no, rw.seal_no, rw.farm_name, rw.farm_address, rw.house_no,
            rw.farm_count, rw.farm_weight_kg, rw.net_live_weight_kg, rw.coop_count, rw.head_count,
            rw.doa_count, rw.doa_weight_kg,
            to_char(rw.farm_departure, 'HH24:MI') AS farm_departure, to_char(rw.plant_arrival, 'HH24:MI') AS plant_arrival,
            to_char(rw.start_hang, 'HH24:MI') AS start_hang, to_char(rw.end_hang, 'HH24:MI') AS end_hang,
            jo.plant_checker,
            (SELECT to_char(MIN(po.created_at), 'YYYY-MM-DD') FROM dp_processed_output po WHERE po.job_order_id = jo.id) AS production_date
       FROM dp_receiving_weights rw
       JOIN dp_job_orders jo ON jo.id = rw.job_order_id
      WHERE jo.company_id = $1
        AND COALESCE(jo.harvest_date, (rw.received_at AT TIME ZONE 'Asia/Manila')::date) = $2::date
      ORDER BY rw.plant_arrival NULLS LAST, rw.received_at, jo.batch_no, rw.seq`,
    [companyId, date],
  );

  const checkers = [...new Set(trucks.map((t) => t.plant_checker).filter(Boolean))].join('; ');
  const prodDates = trucks.map((t) => t.production_date).filter(Boolean).sort();
  return ok({
    date,
    plant_checker: checkers || null,
    production_date: prodDates[0] ?? null,
    batches: [...new Set(trucks.map((t) => String(t.batch_no)))],
    // Arrival sequence across the day, in arrival order.
    trucks: trucks.map((t, i) => ({ ...t, seq: i + 1 })),
  });
}
