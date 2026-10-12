export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requirePermission } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// One plan: what was asked, what the optimizer returned, and — once
// confirmed — the trips that went out.

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requirePermission(request, 'logistics.trip.view'); } catch (e) { return e as Response; }
  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  try {
    const [plan] = await query(
      `SELECT id, plan_no, plan_date, status, input, result, ai_summary, created_at, confirmed_at
         FROM route_plans WHERE id = $1 AND company_id = $2`,
      [params.id, companyId],
    );
    if (!plan) return err('Plan not found', 404);
    const trips = await query(
      `SELECT t.id, t.trip_no, t.plate_no, t.driver_name, t.helper_name,
              to_char(t.depart_time, 'HH24:MI') AS depart_time,
              t.total_kg, t.stop_count, t.planned_km, t.planned_minutes, t.status,
              (SELECT json_agg(json_build_object(
                        'seq', s.seq, 'so_ref', s.so_ref, 'customer_name', s.customer_name,
                        'address', s.address, 'kg', s.kg, 'items', s.items,
                        'eta', to_char(s.eta, 'HH24:MI'),
                        'window_from', to_char(s.window_from, 'HH24:MI'),
                        'window_to', to_char(s.window_to, 'HH24:MI'),
                        'remarks', s.remarks, 'status', s.status) ORDER BY s.seq)
                 FROM trip_stops s WHERE s.trip_id = t.id) AS stops
         FROM trips t
        WHERE t.route_plan_id = $1
        ORDER BY t.trip_no`,
      [params.id],
    );
    return ok({ ...plan, trips });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
