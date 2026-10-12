export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requirePermission } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { evaluatePlan, minToHhmm } from '@/lib/routing/solver';
import { toSolver } from '@/lib/routing/plan';
import type { PlanInput, PlanStop, PlanTruck } from '@/lib/routing/types';

// Turns a draft plan into trips. The dispatcher may have moved stops between
// trucks or changed the order, so the final allotment comes from the request,
// not from the stored result — and is re-checked here with the same rules the
// optimizer used. A plan that breaks a hard rule (over capacity, past shift
// end, …) is refused unless the dispatcher has seen the warnings and accepts.

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requirePermission>>;
  try { auth = await requirePermission(request, 'logistics.trip.plan'); } catch (e) { return e as Response; }

  let dto: {
    company_id?: string;
    assignment?: Record<string, string[]>;
    trucks?: Partial<PlanTruck>[];      // driver / helper edits
    stops?: Partial<PlanStop>[];        // pin / window edits made after optimizing
    accept_warnings?: boolean;
  };
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }
  const companyId = dto.company_id;
  if (!companyId) return err('company_id is required', 400);
  const assignment = dto.assignment ?? {};

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const planRows = await client.query<{ id: string; plan_no: string; plan_date: string; status: string; input: PlanInput }>(
      `SELECT id, plan_no, to_char(plan_date, 'YYYY-MM-DD') AS plan_date, status, input
         FROM route_plans WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [params.id, companyId],
    );
    const plan = planRows.rows[0];
    if (!plan) { await client.query('ROLLBACK'); return err('Plan not found', 404); }
    if (plan.status !== 'draft') { await client.query('ROLLBACK'); return err(`Plan is already ${plan.status}`, 409); }

    // Merge the dispatcher's late edits onto the stored input. Only the fields
    // a person changes on the review screen are taken; ids must already exist.
    const input = plan.input;
    const truckEdits = new Map((dto.trucks ?? []).map((t) => [t.id, t]));
    input.trucks = input.trucks.map((t) => {
      const e = truckEdits.get(t.id);
      return e ? { ...t, driver: String(e.driver ?? t.driver).slice(0, 100), helper: String(e.helper ?? t.helper).slice(0, 100) } : t;
    });
    const stopEdits = new Map((dto.stops ?? []).map((s) => [s.id, s]));
    input.stops = input.stops.map((s) => {
      const e = stopEdits.get(s.id);
      if (!e) return s;
      const lat = e.lat != null ? Number(e.lat) : s.lat;
      const lng = e.lng != null ? Number(e.lng) : s.lng;
      return {
        ...s,
        lat: Number.isFinite(lat) ? lat : s.lat,
        lng: Number.isFinite(lng) ? lng : s.lng,
        pin: e.pin ?? s.pin,
        window_from: e.window_from !== undefined ? e.window_from : s.window_from,
        window_to: e.window_to !== undefined ? e.window_to : s.window_to,
      };
    });

    // Every stop at most once, every truck known.
    const stopIds = new Set(input.stops.map((s) => s.id));
    const truckIds = new Set(input.trucks.map((t) => t.id));
    const seen = new Set<string>();
    for (const [truckId, ids] of Object.entries(assignment)) {
      if (!truckIds.has(truckId)) { await client.query('ROLLBACK'); return err(`Unknown truck ${truckId}`, 400); }
      for (const id of ids) {
        if (!stopIds.has(id)) { await client.query('ROLLBACK'); return err(`Unknown order ${id}`, 400); }
        if (seen.has(id)) { await client.query('ROLLBACK'); return err(`Order ${id} is on two trucks`, 400); }
        seen.add(id);
      }
    }

    const sv = toSolver(input);
    const missingPin = sv.noLocation.filter((u) => seen.has(u.stopId));
    if (missingPin.length) {
      await client.query('ROLLBACK');
      return err(`Set the map pin first for: ${missingPin.map((u) => u.stopId).join(', ')}`, 400);
    }
    const leftOut = input.stops.filter((s) => !seen.has(s.id)).map((s) => ({ stopId: s.id, reason: 'not put on a truck' }));
    const final = evaluatePlan(sv.depot, sv.stops, sv.trucks, assignment, sv.options, leftOut);

    const warnings = final.routes.flatMap((r) => r.violations.map((v) => `${input.trucks.find((t) => t.id === r.truckId)!.plate}: ${v}`));
    if (warnings.length && !dto.accept_warnings) {
      await client.query('ROLLBACK');
      return ok({ needs_confirmation: true, warnings }, 409);
    }

    // Trip numbers run per day across plans: TRP-20261013-01, -02, …
    const stamp = plan.plan_date.replace(/-/g, '');
    const countRes = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM trips WHERE company_id = $1 AND trip_date = $2`,
      [companyId, plan.plan_date],
    );
    let seq = countRes.rows[0].c;
    const stopById = new Map(input.stops.map((s) => [s.id, s]));
    const tripNos: string[] = [];

    for (const r of final.routes) {
      if (!r.stopIds.length) continue;
      const t = input.trucks.find((x) => x.id === r.truckId)!;
      const tripNo = `TRP-${stamp}-${String(++seq).padStart(2, '0')}`;
      tripNos.push(tripNo);
      const tripRes = await client.query<{ id: string }>(
        `INSERT INTO trips (company_id, route_plan_id, trip_no, trip_date, vehicle_id, plate_no,
                            driver_name, helper_name, depart_time, total_kg, stop_count,
                            planned_km, planned_minutes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [companyId, plan.id, tripNo, plan.plan_date, t.vehicle_id, t.plate,
         t.driver || null, t.helper || null, minToHhmm(r.departMin), r.kg.toFixed(2), r.stopIds.length,
         r.km.toFixed(2), Math.round(r.returnMin - r.departMin), auth.userId],
      );
      const tripId = tripRes.rows[0].id;
      for (let i = 0; i < r.visits.length; i++) {
        const v = r.visits[i];
        const s = stopById.get(v.stopId)!;
        await client.query(
          `INSERT INTO trip_stops (trip_id, seq, so_ref, sales_order_id, customer_id, customer_name,
                                   address, latitude, longitude, kg, items, eta, window_from, window_to, remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [tripId, i + 1, s.so_ref, s.sales_order_id, s.customer_id, s.customer,
           s.address, s.lat, s.lng, s.kg, JSON.stringify(s.items), minToHhmm(v.startMin),
           s.window_from, s.window_to, s.remarks || null],
        );
      }
    }

    await client.query(
      `UPDATE route_plans
          SET status = 'confirmed', input = $1, result = $2, confirmed_by = $3, confirmed_at = now()
        WHERE id = $4`,
      [JSON.stringify(input), JSON.stringify(final), auth.userId, plan.id],
    );
    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'confirm','route_plan',$3)`,
      [auth.userId, companyId, plan.id],
    );
    await client.query('COMMIT');
    return ok({ plan_no: plan.plan_no, trips: tripNos, warnings });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = (e as Error).message;
    if (/unique|duplicate/i.test(msg)) return err('Another plan for this date was confirmed at the same moment — reload and try again', 409);
    return err(msg, 500);
  } finally {
    client.release();
  }
}
