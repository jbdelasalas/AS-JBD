// Delivery route solver — allots stops to trucks and orders each truck's stops.
//
// This is a capacitated vehicle-routing problem with time windows on a fixed,
// mixed fleet. It is solved heuristically, which is what every practical
// router does at this size:
//
//   1. Regret insertion builds a first plan. The stop that would cost the most
//      to postpone (best slot vs second-best slot) is placed first, so awkward
//      stops — far away, narrow window, needs the one small truck — are not left
//      until every good slot is taken.
//   2. Local search then improves it: move one stop to another truck or slot,
//      swap two stops between trucks, and reverse a stretch of a route (2-opt).
//
// Pure and dependency-free so the planner page can re-check a route in the
// browser after the dispatcher drags a stop, with the same rules the server
// used to build it.
//
// Distances default to straight-line × a road factor. That is good enough to
// decide who goes on which truck and in what order; ETAs are estimates. A road
// matrix (OSRM, Google) can be passed in later via `matrix` without changing
// anything else.

export interface Depot { lat: number; lng: number }

export interface Stop {
  id: string;
  lat: number;
  lng: number;
  kg: number;
  serviceMin: number;           // unloading time at the stop
  windowFrom?: number | null;   // minutes after midnight
  windowTo?: number | null;
  needsReefer?: boolean;        // dressed chicken: refrigerated truck only
  maxTruckKg?: number | null;   // "small truck only" — narrow road, low gate
  vehicleId?: string | null;    // dispatcher pinned this stop to a truck
}

export interface Truck {
  id: string;
  capacityKg: number;
  reefer: boolean;
  startMin: number;             // earliest departure from the depot
  endMin: number;               // must be back at the depot by
}

export interface SolveOptions {
  speedKmh: number;             // average including traffic
  roadFactor: number;           // road km per straight-line km
  maxOnRoadMin?: number | null; // cold chain: departure → last drop
  returnToDepot: boolean;
  truckFixedCost: number;       // minutes-equivalent for using one more truck
  latePenaltyPerMin: number;
  timeLimitMs: number;
}

export const DEFAULT_OPTIONS: SolveOptions = {
  speedKmh: 25,
  roadFactor: 1.35,
  maxOnRoadMin: null,
  returnToDepot: true,
  truckFixedCost: 60,
  latePenaltyPerMin: 10,
  timeLimitMs: 2500,
};

export interface Visit {
  stopId: string;
  arriveMin: number;
  startMin: number;             // after any wait for the window to open
  departMin: number;
  waitMin: number;
  lateMin: number;
  legKm: number;
}

export interface RouteResult {
  truckId: string;
  stopIds: string[];
  kg: number;
  km: number;
  driveMin: number;
  departMin: number;
  lastDropMin: number;
  returnMin: number;
  visits: Visit[];
  lateStops: number;
  violations: string[];         // hard rules broken (only after manual edits)
  cost: number;
}

export interface Unassigned { stopId: string; reason: string }

export interface Solution {
  routes: RouteResult[];        // one per truck, empty ones included
  unassigned: Unassigned[];
  totals: { km: number; driveMin: number; kg: number; trucksUsed: number; lateStops: number; cost: number };
}

export interface Matrix {
  km(a: number, b: number): number;
  min(a: number, b: number): number;
}

// ── Geometry ────────────────────────────────────────────────────────────────

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Node 0 is the depot; node i+1 is stops[i]. */
export function straightLineMatrix(depot: Depot, stops: Stop[], opt: SolveOptions): Matrix {
  const pts = [depot, ...stops];
  const n = pts.length;
  const km = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineKm(pts[i], pts[j]) * opt.roadFactor;
      km[i * n + j] = d;
      km[j * n + i] = d;
    }
  }
  const perKm = 60 / opt.speedKmh;
  return { km: (a, b) => km[a * n + b], min: (a, b) => km[a * n + b] * perKm };
}

// ── Route evaluation ────────────────────────────────────────────────────────

/**
 * Simulates one truck driving `order` (indexes into `stops`). Lateness against a
 * receiving window is a cost, not a violation — a late delivery is still a
 * delivery and the dispatcher should see it rather than lose the order.
 */
export function simulate(
  truck: Truck, order: number[], stops: Stop[], m: Matrix, opt: SolveOptions,
): RouteResult {
  const violations: string[] = [];
  let kg = 0;
  for (const i of order) kg += stops[i].kg;

  // Leave late enough not to idle at the first stop's gate.
  let depart = truck.startMin;
  if (order.length > 0) {
    const first = stops[order[0]];
    if (first.windowFrom != null) {
      depart = Math.max(depart, first.windowFrom - m.min(0, order[0] + 1));
    }
  }

  let t = depart, km = 0, drive = 0, late = 0, lateStops = 0, prev = 0, lastDrop = depart;
  const visits: Visit[] = [];
  for (const i of order) {
    const s = stops[i];
    const node = i + 1;
    const legKm = m.km(prev, node);
    const legMin = m.min(prev, node);
    km += legKm; drive += legMin; t += legMin;
    const arrive = t;
    let wait = 0;
    if (s.windowFrom != null && t < s.windowFrom) { wait = s.windowFrom - t; t = s.windowFrom; }
    const lateMin = s.windowTo != null && t > s.windowTo ? t - s.windowTo : 0;
    if (lateMin > 0) { late += lateMin; lateStops++; }
    visits.push({ stopId: s.id, arriveMin: arrive, startMin: t, departMin: t + s.serviceMin, waitMin: wait, lateMin, legKm });
    lastDrop = t;
    t += s.serviceMin;
    prev = node;

    if (s.needsReefer && !truck.reefer) violations.push(`${s.id}: needs a refrigerated truck`);
    if (s.maxTruckKg != null && truck.capacityKg > s.maxTruckKg) violations.push(`${s.id}: truck too big for this stop`);
    if (s.vehicleId && s.vehicleId !== truck.id) violations.push(`${s.id}: pinned to another truck`);
  }
  if (order.length > 0 && opt.returnToDepot) {
    km += m.km(prev, 0); drive += m.min(prev, 0); t += m.min(prev, 0);
  }

  if (kg > truck.capacityKg + 1e-6) violations.push(`over capacity by ${Math.round(kg - truck.capacityKg)} kg`);
  if (order.length > 0 && t > truck.endMin) violations.push(`back ${Math.round(t - truck.endMin)} min after shift end`);
  if (order.length > 0 && opt.maxOnRoadMin != null && lastDrop - depart > opt.maxOnRoadMin) {
    violations.push(`last drop ${Math.round(lastDrop - depart - opt.maxOnRoadMin)} min past the cold-chain limit`);
  }

  const waitTotal = visits.reduce((a, v) => a + v.waitMin, 0);
  const cost = order.length === 0 ? 0
    : drive + 0.3 * waitTotal + late * opt.latePenaltyPerMin + opt.truckFixedCost;

  return {
    truckId: truck.id,
    stopIds: order.map((i) => stops[i].id),
    kg, km, driveMin: drive, departMin: depart, lastDropMin: lastDrop, returnMin: t,
    visits, lateStops, violations, cost,
  };
}

// ── Solver ──────────────────────────────────────────────────────────────────

/**
 * simulate() reduced to its cost — Infinity when a hard rule breaks. The search
 * calls this hundreds of thousands of times, so it builds nothing. Must stay in
 * step with simulate(); the solver's final routes are re-simulated, and a test
 * compares the two.
 */
export function routeCost(
  truck: Truck, order: number[], stops: Stop[], m: Matrix, opt: SolveOptions,
): number {
  if (order.length === 0) return 0;
  let kg = 0;
  for (const i of order) {
    const s = stops[i];
    if (s.needsReefer && !truck.reefer) return Infinity;
    if (s.maxTruckKg != null && truck.capacityKg > s.maxTruckKg) return Infinity;
    if (s.vehicleId && s.vehicleId !== truck.id) return Infinity;
    kg += s.kg;
  }
  if (kg > truck.capacityKg + 1e-6) return Infinity;

  const first = stops[order[0]];
  let depart = truck.startMin;
  if (first.windowFrom != null) depart = Math.max(depart, first.windowFrom - m.min(0, order[0] + 1));

  let t = depart, drive = 0, late = 0, wait = 0, prev = 0, lastDrop = depart;
  for (const i of order) {
    const s = stops[i];
    const leg = m.min(prev, i + 1);
    drive += leg; t += leg;
    if (s.windowFrom != null && t < s.windowFrom) { wait += s.windowFrom - t; t = s.windowFrom; }
    if (s.windowTo != null && t > s.windowTo) late += t - s.windowTo;
    lastDrop = t;
    t += s.serviceMin;
    prev = i + 1;
  }
  if (opt.returnToDepot) { drive += m.min(prev, 0); t += m.min(prev, 0); }
  if (t > truck.endMin) return Infinity;
  if (opt.maxOnRoadMin != null && lastDrop - depart > opt.maxOnRoadMin) return Infinity;
  return drive + 0.3 * wait + late * opt.latePenaltyPerMin + opt.truckFixedCost;
}

/**
 * Why a stop could not be placed. Checked against each truck on its own first
 * (a rule no truck can meet), then against what is already loaded.
 */
function rejectReason(
  s: Stop, si: number, trucks: Truck[], loads: number[], stops: Stop[], m: Matrix, opt: SolveOptions,
): string {
  if (!trucks.length) return 'no trucks available';
  if (s.vehicleId && !trucks.some((t) => t.id === s.vehicleId)) return 'pinned truck is not available';
  const idx = trucks.map((_, r) => r).filter((r) => !s.vehicleId || trucks[r].id === s.vehicleId);
  if (s.needsReefer && !idx.some((r) => trucks[r].reefer)) return 'needs a refrigerated truck — none available';
  const fit = idx.filter((r) => (!s.needsReefer || trucks[r].reefer)
    && (s.maxTruckKg == null || trucks[r].capacityKg <= s.maxTruckKg));
  if (!fit.length) return 'only a smaller truck can reach this stop — none available';
  if (!fit.some((r) => trucks[r].capacityKg >= s.kg)) {
    return `${Math.round(s.kg)} kg is more than any single truck carries — split the order`;
  }
  const alone = fit.map((r) => simulate(trucks[r], [si], stops, m, opt));
  if (alone.every((r) => r.violations.length > 0)) {
    return alone[0].violations.find((v) => /shift|cold-chain/.test(v)) ?? 'too far for any truck shift';
  }
  if (!fit.some((r) => trucks[r].capacityKg - loads[r] >= s.kg)) return 'all suitable trucks are full';
  return 'no truck with room can fit it within its shift / cold-chain time';
}

/** Small seeded PRNG so the same input always produces the same plan. */
function prng(seed: number) {
  let x = seed % 2147483647 || 1;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}

const UNASSIGNED_COST = 100_000;

export function solve(
  depot: Depot, stops: Stop[], trucks: Truck[], options: Partial<SolveOptions> = {}, matrix?: Matrix,
): Solution {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const m = matrix ?? straightLineMatrix(depot, stops, opt);
  const deadline = Date.now() + opt.timeLimitMs;
  const timeUp = () => Date.now() >= deadline;
  const cost = (r: number, order: number[]) => routeCost(trucks[r], order, stops, m, opt);
  const rand = prng(stops.length * 7919 + trucks.length);

  interface State { routes: number[][]; costs: number[]; pending: number[] }
  const total = (st: State) =>
    st.costs.reduce((a, c) => a + c, 0) + st.pending.length * UNASSIGNED_COST;
  const clone = (st: State): State =>
    ({ routes: st.routes.map((o) => [...o]), costs: [...st.costs], pending: [...st.pending] });

  // Best slot for stop `si` in route `r`: [delta cost, position] or null.
  const bestSlot = (st: State, si: number, r: number): [number, number] | null => {
    const order = st.routes[r];
    let best: [number, number] | null = null;
    for (let p = 0; p <= order.length; p++) {
      const c = cost(r, [...order.slice(0, p), si, ...order.slice(p)]);
      if (c === Infinity) continue;
      const delta = c - st.costs[r];
      if (!best || delta < best[0]) best = [delta, p];
    }
    return best;
  };

  // Regret insertion of everything pending; whatever fits nowhere stays pending.
  // `first` stops (ones that were left out last time) are placed before anything
  // else, so the room cleared for them is not taken back by their neighbours.
  const insertPending = (st: State, first: Set<number> = new Set()) => {
    const pending = new Set(st.pending);
    const cache = new Map<number, ([number, number] | null)[]>();
    for (const si of pending) cache.set(si, trucks.map((_, r) => bestSlot(st, si, r)));
    while (pending.size > 0) {
      let pick = -1, pickRoute = -1, pickPos = -1, pickRegret = -Infinity, pickCost = Infinity;
      for (const si of pending) {
        let b1 = Infinity, b2 = Infinity, r1 = -1, p1 = -1;
        cache.get(si)!.forEach((s, r) => {
          if (!s) return;
          if (s[0] < b1) { b2 = b1; b1 = s[0]; r1 = r; p1 = s[1]; } else if (s[0] < b2) b2 = s[0];
        });
        if (r1 < 0) continue;
        // A stop with a single feasible truck is the most urgent of all.
        const regret = (b2 === Infinity ? 1e9 : b2 - b1) + (first.has(si) ? 1e10 : 0);
        if (regret > pickRegret || (regret === pickRegret && b1 < pickCost)) {
          pick = si; pickRoute = r1; pickPos = p1; pickRegret = regret; pickCost = b1;
        }
      }
      if (pick < 0) break;
      st.routes[pickRoute].splice(pickPos, 0, pick);
      st.costs[pickRoute] = cost(pickRoute, st.routes[pickRoute]);
      pending.delete(pick);
      cache.delete(pick);
      for (const si of pending) cache.get(si)![pickRoute] = bestSlot(st, si, pickRoute);
    }
    st.pending = [...pending];
  };

  // Commit `changes` only if every touched route stays legal and the total drops.
  const tryApply = (st: State, changes: [number, number[]][]): boolean => {
    let before = 0, after = 0;
    const next: number[] = [];
    for (const [r, order] of changes) {
      const c = cost(r, order);
      if (c === Infinity) return false;
      before += st.costs[r]; after += c;
      next.push(c);
    }
    if (after >= before - 1e-6) return false;
    changes.forEach(([r, order], k) => { st.routes[r] = order; st.costs[r] = next[k]; });
    return true;
  };

  const localSearch = (st: State) => {
    const n = trucks.length;
    let improved = true;
    while (improved && !timeUp()) {
      improved = false;

      // 2-opt: reverse a stretch of one route.
      for (let r = 0; r < n && !improved; r++) {
        const o = st.routes[r];
        for (let i = 0; i < o.length - 1 && !improved; i++) {
          for (let j = i + 1; j < o.length; j++) {
            const next = [...o.slice(0, i), ...o.slice(i, j + 1).reverse(), ...o.slice(j + 1)];
            if (tryApply(st, [[r, next]])) { improved = true; break; }
          }
        }
      }
      if (improved) continue;

      // Relocate one stop to any slot on any truck.
      outer: for (let a = 0; a < n; a++) {
        for (let i = 0; i < st.routes[a].length; i++) {
          const si = st.routes[a][i];
          const from = [...st.routes[a].slice(0, i), ...st.routes[a].slice(i + 1)];
          for (let b = 0; b < n; b++) {
            const base = a === b ? from : st.routes[b];
            for (let p = 0; p <= base.length; p++) {
              if (a === b && p === i) continue;
              const to = [...base.slice(0, p), si, ...base.slice(p)];
              if (a === b ? tryApply(st, [[a, to]]) : tryApply(st, [[a, from], [b, to]])) {
                improved = true; break outer;
              }
            }
          }
          if (timeUp()) break outer;
        }
      }
      if (improved) continue;

      // Swap two stops between trucks.
      outer2: for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          for (let i = 0; i < st.routes[a].length; i++) {
            for (let j = 0; j < st.routes[b].length; j++) {
              const na = [...st.routes[a]]; const nb = [...st.routes[b]];
              [na[i], nb[j]] = [nb[j], na[i]];
              if (tryApply(st, [[a, na], [b, nb]])) { improved = true; break outer2; }
            }
          }
          if (timeUp()) break outer2;
        }
      }

      // Room may have opened up for a stop that did not fit earlier.
      if (st.pending.length) {
        const before = st.pending.length;
        insertPending(st);
        if (st.pending.length < before) improved = true;
      }
    }
  };

  // ── 1. Build, 2. polish ──
  const start: State = {
    routes: trucks.map(() => []),
    costs: trucks.map(() => 0),
    pending: stops.map((_, i) => i),
  };
  insertPending(start);
  localSearch(start);
  let best = start;
  let bestCost = total(best);

  // ── 3. Ruin and recreate with the time that is left ──
  // Pull out a stop and its nearest neighbours, re-insert them, polish, and keep
  // the result if it beats the best plan so far. Removing a neighbourhood lets
  // a whole cluster change trucks, which single moves cannot do.
  //
  // While stops are still left out, most rounds clear the area around one of
  // them instead — a left-out stop is worth far more than a shorter drive, and
  // only clearing room near it gives it a chance. Stops that no truck could
  // serve even alone are skipped; no amount of shuffling places them.
  const placeable = (si: number) => trucks.some((_, r) => cost(r, [si]) < Infinity);
  const hopeless = new Set(best.pending.filter((si) => !placeable(si)));
  let stale = 0;
  while (!timeUp() && stale < 300) {
    stale++;
    const cur = clone(best);
    const all = cur.routes.flat();
    if (all.length < 3) break;
    const waiting = cur.pending.filter((si) => !hopeless.has(si));
    const rescue = waiting.length > 0 && rand() < 0.7;
    const seed = rescue
      ? waiting[Math.floor(rand() * waiting.length)]
      : all[Math.floor(rand() * all.length)];
    const k = Math.max(3, Math.min(25, Math.round(all.length * (0.08 + rand() * 0.12))));
    const out = new Set(
      all.map((si) => [si, m.km(seed + 1, si + 1)] as const)
        .sort((x, y) => x[1] - y[1])
        .slice(0, k)
        .map(([si]) => si),
    );
    for (let r = 0; r < cur.routes.length; r++) {
      const kept = cur.routes[r].filter((si) => !out.has(si));
      if (kept.length !== cur.routes[r].length) {
        cur.routes[r] = kept;
        cur.costs[r] = cost(r, kept);
      }
    }
    const leftOut = new Set(waiting);
    cur.pending = [...cur.pending, ...out];
    insertPending(cur, leftOut);
    localSearch(cur);
    const c = total(cur);
    if (c < bestCost - 1e-6) { best = cur; bestCost = c; stale = 0; }
  }

  const results = trucks.map((t, r) => simulate(t, best.routes[r], stops, m, opt));
  const loads = results.map((r) => r.kg);
  const unassigned = best.pending.map((si) => ({
    stopId: stops[si].id,
    reason: rejectReason(stops[si], si, trucks, loads, stops, m, opt),
  }));
  return summarize(results, unassigned);
}


export function summarize(results: RouteResult[], unassigned: Unassigned[]): Solution {
  const used = results.filter((r) => r.stopIds.length > 0);
  return {
    routes: results,
    unassigned,
    totals: {
      km: used.reduce((a, r) => a + r.km, 0),
      driveMin: used.reduce((a, r) => a + r.driveMin, 0),
      kg: used.reduce((a, r) => a + r.kg, 0),
      trucksUsed: used.length,
      lateStops: used.reduce((a, r) => a + r.lateStops, 0),
      cost: used.reduce((a, r) => a + r.cost, 0),
    },
  };
}

/**
 * Re-checks a plan the dispatcher has edited by hand. Nothing is re-ordered;
 * broken rules come back as `violations` on the affected route.
 */
export function evaluatePlan(
  depot: Depot, stops: Stop[], trucks: Truck[], assignment: Record<string, string[]>,
  options: Partial<SolveOptions> = {}, unassigned: Unassigned[] = [],
): Solution {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const m = straightLineMatrix(depot, stops, opt);
  const index = new Map(stops.map((s, i) => [s.id, i]));
  const results = trucks.map((t) => simulate(
    t, (assignment[t.id] ?? []).map((id) => index.get(id)!).filter((i) => i != null), stops, m, opt,
  ));
  return summarize(results, unassigned);
}

// ── Helpers shared with the page ────────────────────────────────────────────

/** "07:30" → 450. Returns null for blank or unparseable input. */
export function hhmmToMin(v: string | null | undefined): number | null {
  if (!v) return null;
  const mt = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!mt) return null;
  const h = Number(mt[1]), mi = Number(mt[2]);
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

export function minToHhmm(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60) % 24;
  const mi = total % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
