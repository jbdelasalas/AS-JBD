export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requirePermission } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { solve, minToHhmm, type Solution } from '@/lib/routing/solver';
import { toSolver } from '@/lib/routing/plan';
import { rulesFromRemarks, explainPlan, aiAvailable, type RemarkRule } from '@/lib/routing/ai';
import { DEFAULT_PLAN_OPTIONS, type PlanInput, type PlanStop, type PlanTruck } from '@/lib/routing/types';

// POST: optimize a day's deliveries into truck trips and keep the result as a
//       draft plan. Nothing is dispatched until the plan is confirmed.
// GET:  recent plans for a date.

const MAX_STOPS = 400;
const MAX_TRUCKS = 40;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanStop(s: Partial<PlanStop>, i: number): PlanStop {
  const lat = s.lat == null ? null : Number(s.lat);
  const lng = s.lng == null ? null : Number(s.lng);
  const hasPin = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
  return {
    id: String(s.id || `S${i + 1}`).slice(0, 60),
    so_ref: String(s.so_ref ?? s.id ?? '').slice(0, 60),
    sales_order_id: s.sales_order_id || null,
    customer_id: s.customer_id || null,
    customer: String(s.customer ?? '').slice(0, 200) || '(no name)',
    address: String(s.address ?? '').slice(0, 500),
    lat: hasPin ? lat : null,
    lng: hasPin ? lng : null,
    pin: hasPin ? (s.pin ?? 'rough') : 'missing',
    kg: Math.max(0, Number(s.kg) || 0),
    items: Array.isArray(s.items) ? s.items.slice(0, 50) : [],
    window_from: s.window_from && HHMM.test(s.window_from) ? s.window_from : null,
    window_to: s.window_to && HHMM.test(s.window_to) ? s.window_to : null,
    remarks: String(s.remarks ?? '').slice(0, 500),
    needs_reefer: s.needs_reefer !== false,
    small_truck_only: s.small_truck_only === true,
    vehicle_id: s.vehicle_id || null,
  };
}

function cleanTruck(t: Partial<PlanTruck>, i: number): PlanTruck {
  return {
    id: String(t.id || `adhoc-${i + 1}`),
    vehicle_id: t.vehicle_id || null,
    plate: String(t.plate ?? '').toUpperCase().slice(0, 20) || `TRUCK ${i + 1}`,
    capacity_kg: Math.max(0, Number(t.capacity_kg) || 0),
    reefer: t.reefer === true,
    start: t.start && HHMM.test(t.start) ? t.start : '05:00',
    end: t.end && HHMM.test(t.end) ? t.end : '19:00',
    driver: String(t.driver ?? '').slice(0, 100),
    helper: String(t.helper ?? '').slice(0, 100),
  };
}

/** The town/city part of a PH address, for "this truck covers Lipa, Tanauan". */
function area(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2].replace(/\b(city|province)\b/i, '').trim() || parts[parts.length - 2];
  return parts[0] ?? '';
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requirePermission>>;
  try { auth = await requirePermission(request, 'logistics.trip.plan'); } catch (e) { return e as Response; }

  let dto: Partial<PlanInput> & { company_id?: string };
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }
  const companyId = dto.company_id;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.plan_date || !/^\d{4}-\d{2}-\d{2}$/.test(dto.plan_date)) return err('plan_date (YYYY-MM-DD) is required', 400);
  const depot = dto.depot;
  if (!depot || !Number.isFinite(Number(depot.lat)) || !Number.isFinite(Number(depot.lng))) {
    return err('The depot needs a map location — set its pin first', 400);
  }
  const rawStops = Array.isArray(dto.stops) ? dto.stops : [];
  const rawTrucks = Array.isArray(dto.trucks) ? dto.trucks : [];
  if (!rawStops.length) return err('Add at least one order', 400);
  if (!rawTrucks.length) return err('Add at least one truck', 400);
  if (rawStops.length > MAX_STOPS) return err(`At most ${MAX_STOPS} orders per plan`, 400);
  if (rawTrucks.length > MAX_TRUCKS) return err(`At most ${MAX_TRUCKS} trucks per plan`, 400);

  const stops = rawStops.map(cleanStop);
  if (new Set(stops.map((s) => s.id)).size !== stops.length) return err('Each order needs a unique SO number', 400);
  const trucks = rawTrucks.map(cleanTruck);
  if (new Set(trucks.map((t) => t.id)).size !== trucks.length) return err('Duplicate truck in the list', 400);

  const input: PlanInput = {
    plan_date: dto.plan_date,
    depot: { warehouse_id: depot.warehouse_id || null, name: String(depot.name ?? 'Depot'), lat: Number(depot.lat), lng: Number(depot.lng) },
    stops,
    trucks,
    options: { ...DEFAULT_PLAN_OPTIONS, ...(dto.options ?? {}) },
  };

  // ── 1. AI reads the remarks. It only fills gaps: anything the dispatcher
  //       typed in a field wins over what the model inferred from free text.
  let rules: RemarkRule[] = [];
  let aiNote: string | null = null;
  if (input.options.use_ai) {
    if (!aiAvailable()) {
      aiNote = 'AI is not set up (GEMINI_API_KEY missing) — remarks were not read.';
    } else {
      try {
        rules = await rulesFromRemarks(stops.map((s) => ({ id: s.id, customer: s.customer, remarks: s.remarks })));
      } catch (e) {
        aiNote = `AI could not read the remarks this time (${(e as Error).message.slice(0, 120)}). Planned without them.`;
      }
    }
    const byId = new Map(stops.map((s) => [s.id, s]));
    for (const r of rules) {
      const s = byId.get(r.id);
      if (!s) continue;
      if (!s.window_from && r.window_from) s.window_from = r.window_from;
      if (!s.window_to && r.window_to) s.window_to = r.window_to;
      if (r.small_truck_only) s.small_truck_only = true;
      if (r.frozen_or_dressed === false) s.needs_reefer = false;
    }
  }

  // ── 2. Solve.
  const sv = toSolver(input);
  const solution: Solution = solve(sv.depot, sv.stops, sv.trucks, {
    ...sv.options,
    timeLimitMs: sv.stops.length > 120 ? 6000 : sv.stops.length > 60 ? 4000 : 2500,
  });
  solution.unassigned.push(...sv.noLocation);

  // ── 3. AI explains it.
  const stopById = new Map(stops.map((s) => [s.id, s]));
  const summary = input.options.use_ai ? await explainPlan({
    date: input.plan_date,
    depot: input.depot.name,
    trucks: solution.routes.filter((r) => r.stopIds.length).map((r) => {
      const t = trucks.find((x) => x.id === r.truckId)!;
      return {
        plate: t.plate, capacityKg: t.capacity_kg, reefer: t.reefer,
        stops: r.stopIds.length, kg: Math.round(r.kg), km: Math.round(r.km),
        departs: minToHhmm(r.departMin), lastDrop: minToHhmm(r.lastDropMin), returns: minToHhmm(r.returnMin),
        lateStops: r.lateStops,
        areas: [...new Set(r.stopIds.map((id) => area(stopById.get(id)?.address ?? '')).filter(Boolean))].slice(0, 5),
      };
    }),
    idleTrucks: solution.routes.filter((r) => !r.stopIds.length).map((r) => trucks.find((t) => t.id === r.truckId)!.plate),
    unassigned: solution.unassigned.map((u) => ({ customer: stopById.get(u.stopId)?.customer ?? u.stopId, kg: stopById.get(u.stopId)?.kg ?? 0, reason: u.reason })),
    roughAddresses: stops.filter((s) => s.pin === 'rough').length,
    totals: { km: Math.round(solution.totals.km), kg: Math.round(solution.totals.kg), stops: stops.length },
  }) : null;

  // ── 4. Keep it as a draft.
  try {
    const stamp = input.plan_date.replace(/-/g, '');
    const [{ c }] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM route_plans WHERE company_id = $1 AND plan_date = $2`,
      [companyId, input.plan_date],
    );
    const planNo = `RP-${stamp}-${String(c + 1).padStart(2, '0')}`;
    const [row] = await query<{ id: string }>(
      `INSERT INTO route_plans (company_id, plan_no, plan_date, depot_warehouse_id, input, result, ai_summary, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [companyId, planNo, input.plan_date, input.depot.warehouse_id, JSON.stringify(input), JSON.stringify(solution), summary, auth.userId],
    );
    return ok({ id: row.id, plan_no: planNo, input, solution, summary, rules, ai_note: aiNote }, 201);
  } catch (e) {
    return err((e as Error).message, 500);
  }
}

export async function GET(request: NextRequest) {
  try { await requirePermission(request, 'logistics.trip.view'); } catch (e) { return e as Response; }
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  const date = searchParams.get('date');
  if (!companyId) return err('company_id is required', 400);
  try {
    const rows = await query(
      `SELECT p.id, p.plan_no, p.plan_date, p.status, p.created_at, p.confirmed_at,
              jsonb_array_length(p.input->'stops') AS stop_count,
              u.full_name AS created_by_name
         FROM route_plans p
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.company_id = $1 AND ($2::date IS NULL OR p.plan_date = $2::date)
        ORDER BY p.created_at DESC
        LIMIT 50`,
      [companyId, date || null],
    );
    return ok({ data: rows });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
