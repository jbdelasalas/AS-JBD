export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requirePermission } from '@/lib/auth-helpers';
import { err } from '@/lib/api-response';
import { buildTripSummaryXlsx, type ExportTrip } from '@/lib/routing/gps-export';
import type { Solution } from '@/lib/routing/solver';

// A confirmed plan as the GPS tracker's Trip Summary Report (.xlsx), planned
// columns filled in. Only confirmed plans export — a draft has no trips yet.

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requirePermission(request, 'logistics.trip.view'); } catch (e) { return e as Response; }
  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  try {
    const [plan] = await query<{
      plan_no: string; plan_date: string; status: string; result: Solution;
      company: string; depot_code: string | null; depot_name: string | null;
    }>(
      `SELECT p.plan_no, to_char(p.plan_date, 'YYYY-MM-DD') AS plan_date, p.status, p.result,
              co.name AS company, w.code AS depot_code, w.name AS depot_name
         FROM route_plans p
         JOIN companies co ON co.id = p.company_id
         LEFT JOIN warehouses w ON w.id = p.depot_warehouse_id
        WHERE p.id = $1 AND p.company_id = $2`,
      [params.id, companyId],
    );
    if (!plan) return err('Plan not found', 404);
    if (plan.status !== 'confirmed') return err('Confirm the plan first — only confirmed trips can be exported', 409);

    // Planned distance and drive time into each drop, from the confirmed result.
    const legs = new Map<string, { km: number; min: number }>();
    for (const r of plan.result.routes ?? []) {
      let prevDepart = r.departMin;
      for (const v of r.visits ?? []) {
        legs.set(v.stopId, { km: v.legKm, min: v.arriveMin - prevDepart });
        prevDepart = v.departMin;
      }
    }

    const rows = await query<{
      trip_no: string; plate_no: string; vehicle_type: string | null; status: string; driver_name: string | null;
      depart_time: string | null; planned_km: string | null; planned_minutes: number | null;
      stops: { seq: number; so_ref: string | null; customer_name: string; customer_code: string | null; eta: string | null }[] | null;
    }>(
      `SELECT t.trip_no, t.plate_no, COALESCE(v.vehicle_type, v.description) AS vehicle_type, t.status, t.driver_name,
              to_char(t.depart_time, 'HH24:MI') AS depart_time, t.planned_km, t.planned_minutes,
              (SELECT json_agg(json_build_object(
                        'seq', s.seq, 'so_ref', s.so_ref, 'customer_name', s.customer_name,
                        'customer_code', c.code, 'eta', to_char(s.eta, 'HH24:MI')) ORDER BY s.seq)
                 FROM trip_stops s LEFT JOIN customers c ON c.id = s.customer_id
                WHERE s.trip_id = t.id) AS stops
         FROM trips t
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.route_plan_id = $1 AND t.status <> 'cancelled'
        ORDER BY t.trip_no`,
      [params.id],
    );

    const trips: ExportTrip[] = rows.map((t) => ({
      trip_no: t.trip_no,
      plate_no: t.plate_no,
      vehicle_type: t.vehicle_type,
      status: t.status,
      driver_name: t.driver_name,
      depart_time: t.depart_time,
      planned_km: t.planned_km == null ? null : Number(t.planned_km),
      planned_minutes: t.planned_minutes,
      stops: (t.stops ?? []).map((s) => {
        const leg = s.so_ref ? legs.get(s.so_ref) : undefined;
        return { ...s, leg_km: leg?.km ?? null, leg_min: leg?.min ?? null };
      }),
    }));

    const buf = await buildTripSummaryXlsx({
      company: plan.company,
      date: plan.plan_date,
      depot: { code: plan.depot_code, name: plan.depot_name ?? 'Depot' },
      trips,
    });
    const file = `trip_plan_${plan.company.replace(/[^A-Za-z0-9]+/g, '')}_${plan.plan_date.replace(/-/g, '_')}_${plan.plan_no}.xlsx`;
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${file}"`,
      },
    });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
