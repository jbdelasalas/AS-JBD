'use client';

// Trip Planning — Art Fresh chicken deliveries.
//
// 1. Orders: load the day's sales orders from the ERP, or paste the SO list
//    from Excel. Each order needs a map pin; addresses are looked up
//    automatically and anything rough can be dragged into place by clicking.
// 2. Trucks: tick the trucks going out today, with capacity and crew.
// 3. Optimize: the solver allots orders to trucks and orders each route; the
//    AI reads remarks into delivery rules and briefs the dispatcher.
// 4. Review: move stops between trucks or up/down, see the effect at once,
//    then confirm to create the trips and print the trip sheets.

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { api, ApiError } from '@/lib/api';
import { evaluatePlan, minToHhmm, type Solution } from '@/lib/routing/solver';
import { toSolver } from '@/lib/routing/plan';
import { parseOrderSheet } from '@/lib/routing/import';
import { DEFAULT_PLAN_OPTIONS, type PlanInput, type PlanOptions, type PlanStop, type PlanTruck } from '@/lib/routing/types';
import type { MapStop, MapRoute } from '@/components/logistics/RouteMap';

const RouteMap = dynamic(() => import('@/components/logistics/RouteMap'), {
  ssr: false,
  loading: () => <div className="flex h-[460px] items-center justify-center rounded-lg border border-slate-200 text-xs text-slate-400 dark:border-slate-700">Loading map…</div>,
});

interface Vehicle {
  id: string; plate_no: string; description: string | null; capacity_kg: string | null;
  is_refrigerated: boolean; default_driver: string | null; default_helper: string | null; for_delivery: boolean;
}
interface Warehouse { id: string; code: string; name: string; address: string | null; latitude: string | null; longitude: string | null }
interface TruckRow extends PlanTruck { use: boolean }
interface PlanResponse {
  id: string; plan_no: string; input: PlanInput; solution: Solution; summary: string | null;
  rules: { id: string; note: string }[]; ai_note: string | null;
}
interface TripSheet {
  trip_no: string; plate_no: string; driver_name: string | null; helper_name: string | null; depart_time: string | null;
  total_kg: string; stop_count: number; planned_km: string | null; planned_minutes: number | null;
  stops: { seq: number; so_ref: string; customer_name: string; address: string; kg: string; items: { product: string; qty: number; uom: string }[]; eta: string | null; window_from: string | null; window_to: string | null; remarks: string | null }[];
}

const color = (i: number) => `hsl(${Math.round((i * 137.5) % 360)} 70% 40%)`;
const fmtKg = (n: number) => `${Math.round(n).toLocaleString()} kg`;
const tomorrow = () => { const d = new Date(Date.now() + 864e5); return d.toLocaleDateString('en-CA'); };
const input = 'rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const card = 'rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900';
const btn = 'rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800';
const primary = 'rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';

const PIN_BADGE: Record<PlanStop['pin'], [string, string]> = {
  confirmed: ['confirmed', 'bg-emerald-100 text-emerald-700'],
  precise: ['found', 'bg-sky-100 text-sky-700'],
  rough: ['check pin', 'bg-amber-100 text-amber-700'],
  missing: ['no pin', 'bg-red-100 text-red-700'],
};

export default function TripPlanningPage() {
  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const [date, setDate] = useState(tomorrow);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [depotId, setDepotId] = useState('');
  const [stops, setStops] = useState<PlanStop[]>([]);
  const [trucks, setTrucks] = useState<TruckRow[]>([]);
  const [options, setOptions] = useState<PlanOptions>(DEFAULT_PLAN_OPTIONS);

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [assignment, setAssignment] = useState<Record<string, string[]>>({});
  const [pinEdits, setPinEdits] = useState<Record<string, Partial<PlanStop>>>({});
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [sheets, setSheets] = useState<TripSheet[] | null>(null);
  const [confirmedPlanId, setConfirmedPlanId] = useState<string | null>(null);

  const [pinning, setPinning] = useState<{ kind: 'stop' | 'depot'; id: string; label: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const depot = useMemo(() => {
    const w = warehouses.find((x) => x.id === depotId);
    if (!w || w.latitude == null || w.longitude == null) return null;
    return { warehouse_id: w.id, name: `${w.code} — ${w.name}`, lat: Number(w.latitude), lng: Number(w.longitude) };
  }, [warehouses, depotId]);

  // ── Setup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!companyId) return;
    api.get<{ vehicles: Vehicle[]; warehouses: Warehouse[] }>(`/logistics/fleet?company_id=${companyId}`)
      .then((r) => {
        setWarehouses(r.warehouses);
        setDepotId((r.warehouses.find((w) => w.latitude != null) ?? r.warehouses[0])?.id ?? '');
        setTrucks(r.vehicles.map((v) => ({
          use: v.for_delivery, id: v.id, vehicle_id: v.id, plate: v.plate_no,
          capacity_kg: Number(v.capacity_kg ?? 0), reefer: v.is_refrigerated,
          start: '05:00', end: '19:00', driver: v.default_driver ?? '', helper: v.default_helper ?? '',
        })));
      })
      .catch((e) => setError(e.message));
  }, [companyId]);

  const resetPlan = () => { setPlan(null); setAssignment({}); setPinEdits({}); setWarnings(null); setSheets(null); };

  function mergeStops(incoming: PlanStop[]) {
    setStops((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      for (const s of incoming) byId.set(s.id, s);
      return [...byId.values()];
    });
    resetPlan();
  }

  async function loadSalesOrders() {
    setError(null); setNotice(null); setBusy('load');
    try {
      const r = await api.get<{ data: PlanStop[] }>(`/logistics/sales-orders?company_id=${companyId}&date=${date}`);
      mergeStops(r.data);
      setNotice(r.data.length ? `Loaded ${r.data.length} open sales order(s) due ${date}.` : `No open sales orders due ${date}. Paste the list instead?`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  function importPaste() {
    const r = parseOrderSheet(pasteText);
    if (!r.stops.length) { setError(r.warnings.join(' ')); return; }
    mergeStops(r.stops);
    setPasteOpen(false); setPasteText('');
    setNotice(`Imported ${r.stops.length} order(s).${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`);
  }

  function updateStop(id: string, patch: Partial<PlanStop>) {
    setStops((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    resetPlan();
  }

  function updateTruck(id: string, patch: Partial<TruckRow>) {
    setTrucks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (!('driver' in patch || 'helper' in patch)) resetPlan();
  }

  async function saveTruckDefaults(t: TruckRow) {
    if (!t.vehicle_id) return;
    try {
      await api.patch(`/logistics/fleet/${t.vehicle_id}`, {
        company_id: companyId, capacity_kg: t.capacity_kg, is_refrigerated: t.reefer,
        default_driver: t.driver, default_helper: t.helper, for_delivery: t.use,
      });
      setNotice(`Saved ${t.plate} as default.`);
    } catch (e) { setError((e as Error).message); }
  }

  async function saveClientHours(s: PlanStop) {
    if (!s.customer_id) return;
    try {
      await api.patch(`/ar/customers/${s.customer_id}`, { receiving_from: s.window_from ?? null, receiving_to: s.window_to ?? null });
      setStops((prev) => prev.map((x) => (x.id === s.id ? { ...x, hours_source: 'client' } : x)));
      setNotice(`${s.customer}'s usual receiving hours are now ${s.window_from ?? 'any time'}–${s.window_to ?? 'any time'}.`);
    } catch (e) { setError((e as Error).message); }
  }

  async function saveOrderHours(s: PlanStop) {
    if (!s.sales_order_id) return;
    try {
      await api.patch(`/sales/orders/${s.sales_order_id}/receiving-hours`, { receiving_from: s.window_from ?? null, receiving_to: s.window_to ?? null });
      setStops((prev) => prev.map((x) => (x.id === s.id ? { ...x, hours_source: 'order' } : x)));
      setNotice(`Saved receiving hours ${s.window_from ?? 'any time'}–${s.window_to ?? 'any time'} on ${s.so_ref}.`);
    } catch (e) { setError((e as Error).message); }
  }

  function addAdhocTruck() {
    const id = `adhoc-${Date.now()}`;
    setTrucks((prev) => [...prev, { use: true, id, vehicle_id: null, plate: '', capacity_kg: 2000, reefer: true, start: '05:00', end: '19:00', driver: '', helper: '' }]);
    resetPlan();
  }

  // ── Locations ────────────────────────────────────────────────────────────
  async function findLocations() {
    setError(null); setNotice(null);
    let todo = stops.filter((s) => s.pin === 'missing' && s.address.trim());
    if (!todo.length) { setNotice('Every order with an address already has a pin.'); return; }
    let found = 0, failed = 0;
    try {
      while (todo.length) {
        setBusy(`Finding locations… ${todo.length} left`);
        const batch = todo.slice(0, 25);
        const r = await api.post<{ results: { key: string; lat?: number; lng?: number; precise?: boolean; error?: string }[]; remaining: string[] }>(
          '/logistics/geocode', { company_id: companyId, addresses: batch.map((s) => ({ key: s.id, address: s.address })) },
        );
        const hits = new Map(r.results.map((x) => [x.key, x]));
        setStops((prev) => prev.map((s) => {
          const h = hits.get(s.id);
          if (!h || h.lat == null || h.lng == null) return s;
          return { ...s, lat: h.lat, lng: h.lng, pin: h.precise ? 'precise' : 'rough' };
        }));
        found += r.results.filter((x) => x.lat != null).length;
        failed += r.results.filter((x) => x.lat == null).length;
        if (!r.results.length) break; // server made no progress — stop rather than spin
        // The free geocoder handles a few per call; whatever it deferred goes round again.
        const deferred = new Set(r.remaining);
        todo = [...batch.filter((s) => deferred.has(s.id)), ...todo.slice(batch.length)];
      }
      setNotice(`Found ${found} location(s).${failed ? ` ${failed} not found — click "set pin" and place them on the map.` : ''} Pins marked "check pin" are area-level guesses.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); resetPlan(); }
  }

  async function placePin(lat: number, lng: number) {
    if (!pinning) return;
    const p = pinning;
    setPinning(null);
    try {
      if (p.kind === 'depot') {
        await api.post('/logistics/pins', { company_id: companyId, lat, lng, warehouse_id: p.id });
        setWarehouses((prev) => prev.map((w) => (w.id === p.id ? { ...w, latitude: String(lat), longitude: String(lng) } : w)));
      } else {
        const s = stops.find((x) => x.id === p.id);
        await api.post('/logistics/pins', { company_id: companyId, lat, lng, address: s?.address, customer_id: s?.customer_id });
        const patch: Partial<PlanStop> = { lat, lng, pin: 'confirmed' };
        setStops((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
        // After optimizing, a moved pin is re-checked in place instead of discarding the plan.
        if (plan) {
          setPinEdits((prev) => ({ ...prev, [p.id]: { ...prev[p.id], ...patch } }));
        }
      }
      setNotice(`Pin saved for ${p.label}.`);
    } catch (e) { setError((e as Error).message); }
  }

  // ── Optimize ─────────────────────────────────────────────────────────────
  const activeTrucks = trucks.filter((t) => t.use);

  async function optimize() {
    setError(null); setNotice(null); resetPlan();
    if (!depot) { setError('Set the depot pin first (pick the depot, then "set depot pin").'); return; }
    if (!stops.length) { setError('Add orders first.'); return; }
    if (!activeTrucks.length) { setError('Tick at least one truck.'); return; }
    const noCap = activeTrucks.filter((t) => !(t.capacity_kg > 0));
    if (noCap.length) { setError(`Enter capacity (kg) for: ${noCap.map((t) => t.plate || 'new truck').join(', ')}`); return; }
    setBusy('Optimizing routes…');
    try {
      const r = await api.post<PlanResponse>('/logistics/plans', {
        company_id: companyId, plan_date: date, depot, stops,
        trucks: activeTrucks.map(({ use: _use, ...t }) => t), options,
      });
      setPlan(r);
      setAssignment(Object.fromEntries(r.solution.routes.map((x) => [x.truckId, x.stopIds])));
      // AI-inferred windows/flags come back on the input — show them in the order list too.
      setStops((prev) => prev.map((s) => r.input.stops.find((x) => x.id === s.id) ?? s));
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  // The plan as it stands after hand edits, judged by the solver's own rules.
  const planInput = useMemo<PlanInput | null>(() => {
    if (!plan) return null;
    return { ...plan.input, stops: plan.input.stops.map((s) => (pinEdits[s.id] ? { ...s, ...pinEdits[s.id] } : s)) };
  }, [plan, pinEdits]);

  const live = useMemo<Solution | null>(() => {
    if (!planInput) return null;
    const sv = toSolver(planInput);
    const placed = new Set(Object.values(assignment).flat());
    const original = new Map(plan!.solution.unassigned.map((u) => [u.stopId, u.reason]));
    const left = planInput.stops.filter((s) => !placed.has(s.id))
      .map((s) => ({ stopId: s.id, reason: original.get(s.id) ?? 'taken off its truck' }));
    const located = new Set(sv.stops.map((s) => s.id));
    const asg = Object.fromEntries(Object.entries(assignment).map(([k, v]) => [k, v.filter((id) => located.has(id))]));
    return evaluatePlan(sv.depot, sv.stops, sv.trucks, asg, sv.options, left);
  }, [planInput, assignment, plan]);

  function moveStop(stopId: string, to: string) {
    setAssignment((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v.filter((id) => id !== stopId)]));
      if (to) next[to] = [...(next[to] ?? []), stopId];
      return next;
    });
    setWarnings(null);
  }

  function shiftStop(truckId: string, stopId: string, dir: -1 | 1) {
    setAssignment((prev) => {
      const list = [...(prev[truckId] ?? [])];
      const i = list.indexOf(stopId), j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return prev;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...prev, [truckId]: list };
    });
    setWarnings(null);
  }

  async function confirm(acceptWarnings: boolean) {
    if (!plan) return;
    setError(null); setNotice(null); setBusy('Confirming…');
    try {
      const r = await api.post<{ trips: string[] }>(`/logistics/plans/${plan.id}/confirm`, {
        company_id: companyId, assignment, accept_warnings: acceptWarnings,
        trucks: plan.input.trucks.map((t) => {
          const row = trucks.find((x) => x.id === t.id);
          return { id: t.id, driver: row?.driver ?? t.driver, helper: row?.helper ?? t.helper };
        }),
        stops: Object.entries(pinEdits).map(([id, e]) => ({ id, ...e })),
      });
      setWarnings(null);
      setNotice(`Confirmed ${plan.plan_no}: ${r.trips.length} trip(s) — ${r.trips.join(', ')}.`);
      const full = await api.get<{ trips: TripSheet[] }>(`/logistics/plans/${plan.id}?company_id=${companyId}`);
      setSheets(full.trips);
      setConfirmedPlanId(plan.id);
      setStops((prev) => prev.filter((s) => !Object.values(assignment).flat().includes(s.id)));
      setPlan(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (e.detail as { warnings?: string[] })?.warnings) {
        setWarnings((e.detail as { warnings: string[] }).warnings);
      } else setError((e as Error).message);
    } finally { setBusy(null); }
  }

  // The confirmed trips in the GPS tracker's Trip Summary Report layout.
  async function exportForGps() {
    if (!confirmedPlanId) return;
    setError(null); setBusy('Preparing Excel…');
    try {
      const res = await fetch(`/api/v1/logistics/plans/${confirmedPlanId}/gps-export?company_id=${companyId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Export failed (${res.status})`);
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'trip_plan.xlsx';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  // ── Map data ─────────────────────────────────────────────────────────────
  const truckIndex = useMemo(() => new Map((plan?.input.trucks ?? []).map((t, i) => [t.id, i])), [plan]);
  const stopById = useMemo(() => new Map((planInput?.stops ?? stops).map((s) => [s.id, s])), [planInput, stops]);

  const { mapStops, mapRoutes } = useMemo(() => {
    const ms: MapStop[] = [];
    const mr: MapRoute[] = [];
    if (live && planInput && depot) {
      live.routes.forEach((r) => {
        const c = color(truckIndex.get(r.truckId) ?? 0);
        const pts: [number, number][] = [[depot.lat, depot.lng]];
        r.stopIds.forEach((id, k) => {
          const s = stopById.get(id);
          if (!s || s.lat == null || s.lng == null) return;
          pts.push([s.lat, s.lng]);
          const plate = planInput.trucks.find((t) => t.id === r.truckId)?.plate;
          ms.push({ id, lat: s.lat, lng: s.lng, label: String(k + 1), color: c, rough: s.pin === 'rough', title: `${plate} #${k + 1} · ${s.so_ref} · ${s.customer} · ${fmtKg(s.kg)}` });
        });
        if (options.return_to_depot && pts.length > 1) pts.push([depot.lat, depot.lng]);
        mr.push({ color: c, points: pts });
      });
      for (const u of live.unassigned) {
        const s = stopById.get(u.stopId);
        if (s?.lat != null && s.lng != null) ms.push({ id: s.id, lat: s.lat, lng: s.lng, label: '!', color: '#dc2626', rough: s.pin === 'rough', title: `${s.so_ref} · ${s.customer} — ${u.reason}` });
      }
    } else {
      stops.forEach((s, i) => {
        if (s.lat != null && s.lng != null) ms.push({ id: s.id, lat: s.lat, lng: s.lng, label: String(i + 1), color: '#64748b', rough: s.pin === 'rough', title: `${s.so_ref} · ${s.customer} · ${fmtKg(s.kg)}` });
      });
    }
    return { mapStops: ms, mapRoutes: mr };
  }, [live, planInput, depot, stops, stopById, truckIndex, options.return_to_depot]);

  const totalKg = stops.reduce((a, s) => a + s.kg, 0);
  const totalCap = activeTrucks.reduce((a, t) => a + (t.capacity_kg || 0), 0);
  const needPins = stops.filter((s) => s.pin === 'missing').length;
  const roughPins = stops.filter((s) => s.pin === 'rough').length;

  if (!companyId) return <div className="text-sm text-slate-500">Select a company first.</div>;

  return (
    <div className="mx-auto max-w-7xl">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #trip-sheets, #trip-sheets * { visibility: visible !important; }
        #trip-sheets { position: absolute; inset: 0 auto auto 0; width: 100%; }
        .sheet { break-after: page; }
      }`}</style>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Trip Planning</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Allot the day&rsquo;s orders to trucks and plan each route. Review, adjust, then confirm to create the trips.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600 dark:text-slate-400">Delivery date
            <input type="date" value={date} onChange={(e) => { setDate(e.target.value); resetPlan(); }} className={`${input} ml-1`} />
          </label>
          <label className="text-xs text-slate-600 dark:text-slate-400">Depot
            <select value={depotId} onChange={(e) => { setDepotId(e.target.value); resetPlan(); }} className={`${input} ml-1`}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}{w.latitude == null ? ' (no pin)' : ''}</option>)}
            </select>
          </label>
          {depotId && (
            <button className={btn} onClick={() => setPinning({ kind: 'depot', id: depotId, label: 'depot' })}>
              {depot ? 'Move depot pin' : 'Set depot pin'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>}
      {busy && <div className="mb-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">{busy}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Left: orders + trucks ── */}
        <div className="space-y-4">
          <section className={card}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">1 · Orders</h2>
              <span className="text-xs text-slate-500">{stops.length} orders · {fmtKg(totalKg)}</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <button className={btn} disabled={!!busy} onClick={loadSalesOrders}>Load SOs for {date}</button>
                <button className={btn} onClick={() => setPasteOpen((v) => !v)}>Paste from Excel</button>
                <button className={btn} disabled={!!busy || !needPins} onClick={findLocations}>Find locations{needPins ? ` (${needPins})` : ''}</button>
                {stops.length > 0 && <button className={btn} onClick={() => { setStops([]); resetPlan(); }}>Clear</button>}
              </div>
            </div>

            {pasteOpen && (
              <div className="mb-3 rounded border border-slate-200 p-2 dark:border-slate-700">
                <p className="mb-1 text-[11px] text-slate-500">
                  Copy the rows from Excel including the header row. Needed: <b>SO</b>, <b>Customer</b>, <b>Address</b>. Optional: Product, Qty, UOM, Kg, Remarks, From, To.
                  Several rows with the same SO become one stop.
                </p>
                <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6}
                  placeholder={'SO No\tCustomer\tAddress\tProduct\tQty\tUOM\tRemarks\nSO-1001\tAling Nena Store\tP. Torres St, Lipa City, Batangas\tWhole Chicken\t120\tkg\tback gate, before 9am'}
                  className={`${input} w-full font-mono`} />
                <div className="mt-1 flex justify-end gap-1.5">
                  <button className={btn} onClick={() => setPasteOpen(false)}>Cancel</button>
                  <button className={btn} disabled={!pasteText.trim()} onClick={importPaste}>Import</button>
                </div>
              </div>
            )}

            <div className="max-h-[420px] overflow-auto rounded border border-slate-100 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-1.5 text-left">#</th>
                    <th className="px-2 py-1.5 text-left">SO / Customer</th>
                    <th className="px-2 py-1.5 text-right">Kg</th>
                    <th className="px-2 py-1.5 text-left" title="Client's receiving hours. Blank = any time.">Receiving hours</th>
                    <th className="px-2 py-1.5 text-center" title="Needs refrigerated truck">Cold</th>
                    <th className="px-2 py-1.5 text-center" title="Small truck only">Small</th>
                    <th className="px-2 py-1.5 text-left">Pin</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {stops.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Load the day&rsquo;s sales orders or paste the SO list.</td></tr>
                  ) : stops.map((s, i) => (
                    <tr key={s.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                      <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <div className="font-mono text-slate-900 dark:text-slate-100">{s.so_ref}</div>
                        <div className="text-slate-700 dark:text-slate-300">{s.customer}</div>
                        <div className="text-[11px] text-slate-500">{s.address || <span className="text-red-600">no address</span>}</div>
                        {s.items.length > 0 && <div className="text-[11px] text-slate-400">{s.items.map((it) => `${it.product} ${it.qty} ${it.uom}`).join(', ')}</div>}
                        {s.remarks && <div className="text-[11px] italic text-slate-500">“{s.remarks}”</div>}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input type="number" min={0} value={s.kg || ''} onChange={(e) => updateStop(s.id, { kg: Number(e.target.value) })}
                          className={`${input} w-20 text-right ${s.kg > 0 ? '' : 'border-red-400'}`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <input type="time" value={s.window_from ?? ''} onChange={(e) => updateStop(s.id, { window_from: e.target.value || null, hours_source: 'plan' })} className={`${input} w-[84px]`} />
                          <span className="text-slate-400">–</span>
                          <input type="time" value={s.window_to ?? ''} onChange={(e) => updateStop(s.id, { window_to: e.target.value || null, hours_source: 'plan' })} className={`${input} w-[84px]`} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
                          {s.hours_source && (
                            <span className={s.hours_source === 'plan' ? 'text-amber-700' : 'text-slate-400'}>
                              {s.hours_source === 'order' ? 'set on this SO' : s.hours_source === 'client' ? "client's usual" : 'changed here — this plan only'}
                            </span>
                          )}
                          {s.hours_source === 'plan' && s.sales_order_id && (
                            <button className="text-brand-600 hover:underline" title="Save on this sales order only"
                              onClick={() => saveOrderHours(s)}>save on SO</button>
                          )}
                          {s.hours_source === 'plan' && s.customer_id && (
                            <button className="text-brand-600 hover:underline" title="Make these the client's usual hours for all future orders"
                              onClick={() => saveClientHours(s)}>save as client&rsquo;s usual</button>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={s.needs_reefer} onChange={(e) => updateStop(s.id, { needs_reefer: e.target.checked })} /></td>
                      <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={s.small_truck_only} onChange={(e) => updateStop(s.id, { small_truck_only: e.target.checked })} /></td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PIN_BADGE[s.pin][1]}`}>{PIN_BADGE[s.pin][0]}</span>
                        <button className="ml-1 text-[11px] text-brand-600 hover:underline" onClick={() => setPinning({ kind: 'stop', id: s.id, label: `${s.so_ref} ${s.customer}` })}>set pin</button>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button className="text-slate-400 hover:text-red-600" title="Remove" onClick={() => { setStops((p) => p.filter((x) => x.id !== s.id)); resetPlan(); }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {roughPins > 0 && <p className="mt-1.5 text-[11px] text-amber-700">{roughPins} pin(s) are area-level guesses (dashed outline on the map). Routes still work; ETAs are better once they are placed exactly.</p>}
          </section>

          <section className={card}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">2 · Trucks available</h2>
              <span className={`text-xs ${totalCap < totalKg ? 'text-red-600' : 'text-slate-500'}`}>
                {activeTrucks.length} trucks · {fmtKg(totalCap)} capacity{totalCap < totalKg ? ` — ${fmtKg(totalKg - totalCap)} short` : ''}
              </span>
              <button className={`${btn} ml-auto`} onClick={addAdhocTruck}>+ Rented / extra truck</button>
            </div>
            <div className="max-h-[320px] overflow-auto rounded border border-slate-100 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-1.5 text-center">Use</th>
                    <th className="px-2 py-1.5 text-left">Plate</th>
                    <th className="px-2 py-1.5 text-right">Cap. kg</th>
                    <th className="px-2 py-1.5 text-center">Reefer</th>
                    <th className="px-2 py-1.5 text-left">Shift</th>
                    <th className="px-2 py-1.5 text-left">Driver / Helper</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {trucks.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No vehicles yet. Add them under Fuel → Vehicles, or add a truck here.</td></tr>
                  ) : trucks.map((t) => (
                    <tr key={t.id} className={`border-t border-slate-100 dark:border-slate-800 ${t.use ? '' : 'opacity-50'}`}>
                      <td className="px-2 py-1 text-center"><input type="checkbox" checked={t.use} onChange={(e) => updateTruck(t.id, { use: e.target.checked })} /></td>
                      <td className="px-2 py-1">
                        {t.vehicle_id ? <span className="font-mono">{t.plate}</span>
                          : <input value={t.plate} placeholder="Plate" onChange={(e) => updateTruck(t.id, { plate: e.target.value.toUpperCase() })} className={`${input} w-24`} />}
                      </td>
                      <td className="px-2 py-1 text-right"><input type="number" min={0} value={t.capacity_kg || ''} onChange={(e) => updateTruck(t.id, { capacity_kg: Number(e.target.value) })} className={`${input} w-20 text-right`} /></td>
                      <td className="px-2 py-1 text-center"><input type="checkbox" checked={t.reefer} onChange={(e) => updateTruck(t.id, { reefer: e.target.checked })} /></td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1">
                          <input type="time" value={t.start} onChange={(e) => updateTruck(t.id, { start: e.target.value })} className={`${input} w-[84px]`} />
                          <span className="text-slate-400">–</span>
                          <input type="time" value={t.end} onChange={(e) => updateTruck(t.id, { end: e.target.value })} className={`${input} w-[84px]`} />
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex gap-1">
                          <input value={t.driver} placeholder="Driver" onChange={(e) => updateTruck(t.id, { driver: e.target.value })} className={`${input} w-24`} />
                          <input value={t.helper} placeholder="Helper" onChange={(e) => updateTruck(t.id, { helper: e.target.value })} className={`${input} w-24`} />
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right">
                        {t.vehicle_id
                          ? <button className="text-[11px] text-brand-600 hover:underline" title="Remember capacity, reefer, crew and 'use' for next time" onClick={() => saveTruckDefaults(t)}>save</button>
                          : <button className="text-slate-400 hover:text-red-600" onClick={() => { setTrucks((p) => p.filter((x) => x.id !== t.id)); resetPlan(); }}>✕</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={card}>
            <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">3 · Rules</h2>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-3 dark:text-slate-400">
              <label>Avg speed (km/h)<input type="number" min={5} value={options.speed_kmh} onChange={(e) => { setOptions({ ...options, speed_kmh: Number(e.target.value) }); resetPlan(); }} className={`${input} mt-0.5 w-full`} /></label>
              <label>Unloading per stop (min)<input type="number" min={0} value={options.service_min} onChange={(e) => { setOptions({ ...options, service_min: Number(e.target.value) }); resetPlan(); }} className={`${input} mt-0.5 w-full`} /></label>
              <label title="Longest time from leaving the depot to the last drop — keeps dressed chicken cold">Cold-chain limit (hrs)
                <input type="number" min={0} step={0.5} value={options.max_on_road_min ? options.max_on_road_min / 60 : ''} placeholder="none"
                  onChange={(e) => { setOptions({ ...options, max_on_road_min: e.target.value ? Number(e.target.value) * 60 : null }); resetPlan(); }} className={`${input} mt-0.5 w-full`} /></label>
              <label title="A stop marked 'small truck only' gets a truck of at most this capacity">Small truck = up to (kg)<input type="number" min={0} value={options.small_truck_max_kg} onChange={(e) => { setOptions({ ...options, small_truck_max_kg: Number(e.target.value) }); resetPlan(); }} className={`${input} mt-0.5 w-full`} /></label>
              <label className="flex items-center gap-1.5 pt-4" title="On: a truck may arrive early and wait, but is never planned to arrive after a client stops receiving — such orders are left off with the reason. Off: late arrivals are allowed and flagged.">
                <input type="checkbox" checked={options.strict_windows} onChange={(e) => { setOptions({ ...options, strict_windows: e.target.checked }); resetPlan(); }} /> Never deliver outside receiving hours</label>
              <label className="flex items-center gap-1.5 pt-4"><input type="checkbox" checked={options.return_to_depot} onChange={(e) => { setOptions({ ...options, return_to_depot: e.target.checked }); resetPlan(); }} /> Trucks return to depot</label>
              <label className="flex items-center gap-1.5 pt-4"><input type="checkbox" checked={options.use_ai} onChange={(e) => { setOptions({ ...options, use_ai: e.target.checked }); resetPlan(); }} /> AI reads remarks &amp; explains</label>
            </div>
            <div className="mt-3 flex justify-end">
              <button className={primary} disabled={!!busy || !stops.length || !activeTrucks.length} onClick={optimize}>
                Optimize {stops.length} orders on {activeTrucks.length} trucks
              </button>
            </div>
          </section>
        </div>

        {/* ── Right: map + plan ── */}
        <div className="space-y-4">
          <RouteMap
            depot={depot}
            stops={mapStops}
            routes={mapRoutes}
            pinning={pinning?.label ?? null}
            onPick={placePin}
          />

          {plan && live && (
            <section className={card}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">4 · Plan {plan.plan_no}</h2>
                <div className="ml-auto flex gap-1.5">
                  <button className={btn} disabled={!!busy} onClick={optimize}>Re-optimize</button>
                  <button className={primary} disabled={!!busy} onClick={() => confirm(false)}>Confirm trips</button>
                </div>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ['Trucks used', `${live.totals.trucksUsed} / ${plan.input.trucks.length}`],
                  ['Load', fmtKg(live.totals.kg)],
                  ['Distance', `${Math.round(live.totals.km).toLocaleString()} km`],
                  ['Late stops', String(live.totals.lateStops)],
                  ['Not placed', String(live.unassigned.length)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded border border-slate-100 px-2 py-1.5 dark:border-slate-800">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
                    <div className={`text-sm font-semibold ${(k === 'Not placed' || k === 'Late stops') && v !== '0' ? 'text-red-600' : 'text-slate-900 dark:text-slate-100'}`}>{v}</div>
                  </div>
                ))}
              </div>

              {plan.summary && (
                <div className="mb-3 rounded border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200">
                  <div className="mb-1 font-semibold">AI briefing</div>
                  <div className="whitespace-pre-wrap">{plan.summary}</div>
                </div>
              )}
              {plan.ai_note && <p className="mb-2 text-[11px] text-amber-700">{plan.ai_note}</p>}
              {plan.rules.filter((r) => r.note).length > 0 && (
                <details className="mb-3 text-[11px] text-slate-600 dark:text-slate-400">
                  <summary className="cursor-pointer">AI read {plan.rules.filter((r) => r.note).length} remark(s) — check what it understood</summary>
                  <ul className="mt-1 space-y-0.5 pl-4">
                    {plan.rules.filter((r) => r.note).map((r) => <li key={r.id}><span className="font-mono">{r.id}</span>: {r.note}</li>)}
                  </ul>
                </details>
              )}

              {warnings && (
                <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <div className="mb-1 font-semibold">This plan breaks some rules:</div>
                  <ul className="list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  <div className="mt-2 flex gap-1.5">
                    <button className={btn} onClick={() => setWarnings(null)}>Go back and fix</button>
                    <button className={btn} onClick={() => confirm(true)}>Confirm anyway</button>
                  </div>
                </div>
              )}

              {live.unassigned.length > 0 && (
                <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950">
                  <div className="mb-1 text-xs font-semibold text-red-700 dark:text-red-300">Not on any truck</div>
                  {live.unassigned.map((u) => {
                    const s = stopById.get(u.stopId);
                    return (
                      <div key={u.stopId} className="flex flex-wrap items-center gap-2 border-t border-red-100 py-1 text-xs first:border-0 dark:border-red-900">
                        <span className="font-mono">{s?.so_ref}</span>
                        <span>{s?.customer}</span>
                        <span className="text-slate-500">{fmtKg(s?.kg ?? 0)}</span>
                        <span className="text-red-700 dark:text-red-300">— {u.reason}</span>
                        <select value="" onChange={(e) => moveStop(u.stopId, e.target.value)} className={`${input} ml-auto`}>
                          <option value="">Put on truck…</option>
                          {plan.input.trucks.map((t) => <option key={t.id} value={t.id}>{t.plate}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-2">
                {live.routes.map((r) => {
                  const t = plan.input.trucks.find((x) => x.id === r.truckId)!;
                  const c = color(truckIndex.get(r.truckId) ?? 0);
                  const pct = t.capacity_kg ? Math.min(100, (r.kg / t.capacity_kg) * 100) : 0;
                  return (
                    <div key={r.truckId} className="rounded border border-slate-200 dark:border-slate-700">
                      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-xs dark:border-slate-800" style={{ borderLeft: `4px solid ${c}` }}>
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{t.plate}</span>
                        {t.reefer && <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-700">reefer</span>}
                        <span className="text-slate-500">{trucks.find((x) => x.id === t.id)?.driver || t.driver || 'no driver'}</span>
                        {r.stopIds.length === 0 ? <span className="ml-auto text-slate-400">idle</span> : (
                          <span className="ml-auto text-slate-600 dark:text-slate-400">
                            {r.stopIds.length} stops · {Math.round(r.km)} km · {minToHhmm(r.departMin)}→{minToHhmm(r.returnMin)}
                          </span>
                        )}
                      </div>
                      {r.stopIds.length > 0 && (
                        <>
                          <div className="px-2 pt-1.5">
                            <div className="h-1.5 rounded bg-slate-100 dark:bg-slate-800">
                              <div className={`h-1.5 rounded ${pct > 100 ? 'bg-red-500' : pct > 90 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="mt-0.5 text-[10px] text-slate-500">{fmtKg(r.kg)} of {fmtKg(t.capacity_kg)} ({Math.round((r.kg / (t.capacity_kg || 1)) * 100)}%)</div>
                          </div>
                          {r.violations.length > 0 && (
                            <div className="mx-2 mt-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{r.violations.join(' · ')}</div>
                          )}
                          <table className="mt-1 w-full text-[11px]">
                            <tbody>
                              {r.visits.map((v, k) => {
                                const s = stopById.get(v.stopId)!;
                                return (
                                  <tr key={v.stopId} className="border-t border-slate-50 dark:border-slate-800">
                                    <td className="w-6 px-2 py-1 text-center font-semibold" style={{ color: c }}>{k + 1}</td>
                                    <td className="px-1 py-1">
                                      <span className="font-mono">{s.so_ref}</span> · {s.customer}
                                      <div className="text-[10px] text-slate-500">{s.address}</div>
                                    </td>
                                    <td className="px-1 py-1 text-right text-slate-600">{fmtKg(s.kg)}</td>
                                    <td className="px-1 py-1 text-right">
                                      <span className={v.lateMin > 0 ? 'font-semibold text-red-600' : 'text-slate-700 dark:text-slate-300'}>{minToHhmm(v.startMin)}</span>
                                      {(s.window_from || s.window_to) && <div className="text-[10px] text-slate-400">opens {s.window_from ?? '…'}–{s.window_to ?? '…'}</div>}
                                      {v.waitMin >= 5 && <div className="text-[10px] text-amber-600" title={`Arrives ${minToHhmm(v.arriveMin)}, waits for the client to open`}>waits {Math.round(v.waitMin)} min</div>}
                                    </td>
                                    <td className="whitespace-nowrap px-1 py-1 text-right">
                                      <button className="px-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={k === 0} onClick={() => shiftStop(r.truckId, v.stopId, -1)}>▲</button>
                                      <button className="px-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={k === r.visits.length - 1} onClick={() => shiftStop(r.truckId, v.stopId, 1)}>▼</button>
                                      <select value={r.truckId} onChange={(e) => moveStop(v.stopId, e.target.value)} className="ml-1 rounded border border-slate-200 bg-transparent px-1 text-[10px] dark:border-slate-700">
                                        {plan.input.trucks.map((x) => <option key={x.id} value={x.id}>{x.plate}</option>)}
                                        <option value="">— take off</option>
                                      </select>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] text-slate-400">Distances and ETAs are estimates from map distance × road factor at the average speed set in Rules.</p>
            </section>
          )}

          {sheets && (
            <section className={card}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Trip sheets</h2>
                <button className={`${btn} ml-auto`} disabled={!confirmedPlanId || !!busy} onClick={exportForGps}
                  title="The GPS tracker's Trip Summary Report layout, with planned arrivals filled in">Export for GPS (Excel)</button>
                <button className={btn} onClick={() => window.print()}>Print trip sheets</button>
              </div>
              <div id="trip-sheets" className="space-y-4 text-xs text-slate-900 dark:text-slate-100">
                {sheets.map((t) => (
                  <div key={t.trip_no} className="sheet rounded border border-slate-200 p-3 dark:border-slate-700">
                    <div className="mb-2 flex flex-wrap justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold">Art Fresh — Trip Sheet {t.trip_no}</div>
                        <div>Date: {date} · Truck: <b>{t.plate_no}</b> · Depart: {t.depart_time ?? '—'}</div>
                        <div>Driver: {t.driver_name ?? '________'} · Helper: {t.helper_name ?? '________'}</div>
                      </div>
                      <div className="text-right">
                        <div>{t.stop_count} stops · {fmtKg(Number(t.total_kg))}</div>
                        <div>~{Math.round(Number(t.planned_km ?? 0))} km · ~{Math.round((t.planned_minutes ?? 0) / 60 * 10) / 10} h</div>
                      </div>
                    </div>
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-400 text-left">
                          <th className="py-1 pr-1">#</th><th className="pr-1">ETA</th><th className="pr-1">SO</th><th className="pr-1">Customer / Address</th>
                          <th className="pr-1">Items</th><th className="pr-1 text-right">Kg</th><th className="w-28 pr-1">Received by / time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(t.stops ?? []).map((s) => (
                          <tr key={s.seq} className="border-b border-slate-200 align-top">
                            <td className="py-1.5 pr-1">{s.seq}</td>
                            <td className="pr-1">{s.eta}{s.window_to ? <div className="text-[10px]">by {s.window_to}</div> : null}</td>
                            <td className="pr-1 font-mono">{s.so_ref}</td>
                            <td className="pr-1"><b>{s.customer_name}</b><div>{s.address}</div>{s.remarks && <div className="italic">{s.remarks}</div>}</td>
                            <td className="pr-1">{(s.items ?? []).map((it) => `${it.product} ${it.qty} ${it.uom}`).join('; ')}</td>
                            <td className="pr-1 text-right">{Number(s.kg).toLocaleString()}</td>
                            <td className="pr-1" />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-6 flex justify-between text-[11px]">
                      <span>Prepared by: ____________</span><span>Checked out (guard): ____________</span><span>Driver: ____________</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
