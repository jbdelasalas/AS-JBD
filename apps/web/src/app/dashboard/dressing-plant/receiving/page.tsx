'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface JobOrder {
  id: string; batch_no: string; client_name: string; farm_location: string | null; expected_truck_plate: string | null;
  receiving_completed_at: string | null;
}
interface Truck {
  id: string; seq: number; plate_no: string | null; seal_no: string | null; farm_name: string | null; farm_address: string | null;
  house_no: string | null; farm_count: number | null; farm_weight_kg: string | null; gross_weight_kg: string; tare_weight_kg: string;
  net_live_weight_kg: string; coop_count: number; head_count: number; doa_count: number; doa_weight_kg: string | null;
  farm_departure: string | null; plant_arrival: string | null; start_hang: string | null; end_hang: string | null;
}
interface BatchInfo { job: { harvest_date: string | null; plant_checker: string | null } }

const FIELDS: { key: string; label: string; type: 'text' | 'number' | 'time'; req?: boolean; span?: number }[] = [
  { key: 'plate_no', label: 'Plate no.', type: 'text' },
  { key: 'seal_no', label: 'Seal no.', type: 'text' },
  { key: 'farm_name', label: 'Farm name', type: 'text', span: 2 },
  { key: 'farm_address', label: 'Farm address', type: 'text', span: 2 },
  { key: 'house_no', label: 'Building / house no.', type: 'text' },
  { key: 'farm_count', label: 'Farm count', type: 'number' },
  { key: 'farm_weight_kg', label: 'Farm weight kg', type: 'number' },
  { key: 'head_count', label: 'Plant count *', type: 'number', req: true },
  { key: 'gross_weight_kg', label: 'Gross kg *', type: 'number', req: true },
  { key: 'tare_weight_kg', label: 'Tare kg', type: 'number' },
  { key: 'coop_count', label: 'Coops', type: 'number' },
  { key: 'doa_count', label: 'DOA', type: 'number' },
  { key: 'doa_weight_kg', label: 'DOA kg', type: 'number' },
  { key: 'farm_departure', label: 'Farm departure', type: 'time' },
  { key: 'plant_arrival', label: 'Plant arrival', type: 'time' },
  { key: 'start_hang', label: 'Start hang', type: 'time' },
  { key: 'end_hang', label: 'End hang', type: 'time' },
];

const n2 = (v: unknown) => (v == null || v === '' ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 }));

export default function ReceivingPage() {
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [jobOrderId, setJobOrderId] = useState('');
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [harvestDate, setHarvestDate] = useState('');
  const [checker, setChecker] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;
  const jo = orders.find((o) => o.id === jobOrderId);

  // Batches still receiving (not marked complete).
  const loadOrders = useCallback(() => {
    if (!companyId) return;
    api.get<{ data: JobOrder[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => {
        const open = r.data.filter((o) => !o.receiving_completed_at);
        setOrders(open);
        const batch = new URLSearchParams(window.location.search).get('batch');
        setJobOrderId((cur) => (open.some((o) => o.id === cur) ? cur
          : batch && open.some((o) => o.id === batch) ? batch : (open[0]?.id ?? '')));
      })
      .catch(() => {});
  }, [companyId]);

  const loadBatch = useCallback((id: string) => {
    if (!companyId || !id) { setTrucks([]); return; }
    api.get<{ data: Truck[] }>(`/dressing-plant/receiving?company_id=${companyId}&job_order_id=${id}`)
      .then((r) => setTrucks(r.data)).catch((e) => setError(e.message));
    api.get<BatchInfo>(`/dressing-plant/batch-info?job_order_id=${id}`)
      .then((r) => { setHarvestDate(r.job.harvest_date ?? ''); setChecker(r.job.plant_checker ?? ''); }).catch(() => {});
  }, [companyId]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { loadBatch(jobOrderId); setError(null); setNotice(null); }, [jobOrderId, loadBatch]);

  // New truck form starts from the last truck's farm details (same farm, next truck).
  useEffect(() => {
    const last = trucks[trucks.length - 1];
    setForm({
      farm_name: last?.farm_name ?? jo?.farm_location ?? '',
      farm_address: last?.farm_address ?? '',
      plate_no: trucks.length === 0 ? (jo?.expected_truck_plate ?? '') : '',
    });
  }, [trucks, jo?.farm_location, jo?.expected_truck_plate]);

  async function addTruck(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setNotice(null);
    if (!jobOrderId) return;
    if (!(Number(form.gross_weight_kg) > 0) || !(Number(form.head_count) > 0)) { setError('Plant count and gross weight are required'); return; }
    setSaving(true);
    try {
      const r = await api.post<{ seq: number }>('/dressing-plant/receiving', { job_order_id: jobOrderId, ...form });
      setNotice(`Truck ${r.seq} recorded.`);
      loadBatch(jobOrderId);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function removeTruck(t: Truck) {
    if (!window.confirm(`Remove truck ${t.seq}${t.plate_no ? ` (${t.plate_no})` : ''}?`)) return;
    try { await api.delete(`/dressing-plant/receiving?id=${t.id}`); loadBatch(jobOrderId); } catch (e) { setError((e as Error).message); }
  }

  async function saveHeader() {
    try { await api.put('/dressing-plant/batch-info', { job_order_id: jobOrderId, harvest_date: harvestDate, plant_checker: checker }); setNotice('Saved.'); }
    catch (e) { setError((e as Error).message); }
  }

  async function complete() {
    if (!window.confirm(`Mark receiving complete for ${jo?.batch_no} (${trucks.length} trucks)? No more trucks can be added.`)) return;
    try {
      await api.put('/dressing-plant/batch-info', { job_order_id: jobOrderId, receiving_complete: true, harvest_date: harvestDate, plant_checker: checker });
      setNotice(`${jo?.batch_no} receiving complete.`);
      loadOrders();
    } catch (e) { setError((e as Error).message); }
  }

  const tot = trucks.reduce((a, t) => ({
    farm: a.farm + Number(t.farm_count || 0), plant: a.plant + Number(t.head_count || 0), doa: a.doa + Number(t.doa_count || 0),
    kg: a.kg + Number(t.net_live_weight_kg || 0), coops: a.coops + Number(t.coop_count || 0),
  }), { farm: 0, plant: 0, doa: 0, kg: 0, coops: 0 });

  const inputCls = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const labelCls = 'mb-1 block text-xs text-slate-600 dark:text-slate-400';
  const th = 'px-2 py-2 text-right';
  const td = 'px-2 py-1.5 text-right text-xs text-slate-700 dark:text-slate-300';

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Receiving &amp; Weighing</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Live-bird receiving, one entry per truck. The first truck locks the batch (no journal entry). Plant weight = gross − tare.</p>
        </div>
        {jobOrderId && <Link href={`/dashboard/dressing-plant/live-harvest-report?batch=${jobOrderId}`} className="text-xs text-brand-600 hover:underline">Live Harvest Report →</Link>}
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>}

      <div className="mb-4 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-12 sm:col-span-4">
          <label className={labelCls}>Batch *</label>
          <select value={jobOrderId} onChange={(e) => setJobOrderId(e.target.value)} className={inputCls}>
            {orders.length === 0 && <option value="">No batches waiting to be received</option>}
            {orders.map((o) => <option key={o.id} value={o.id}>{o.batch_no} — {o.client_name}</option>)}
          </select>
        </div>
        <div className="col-span-6 sm:col-span-2">
          <label className={labelCls}>Harvest date</label>
          <input type="date" value={harvestDate} onChange={(e) => setHarvestDate(e.target.value)} onBlur={saveHeader} disabled={!jobOrderId} className={inputCls} />
        </div>
        <div className="col-span-6 sm:col-span-6">
          <label className={labelCls}>Plant checker(s)</label>
          <input value={checker} onChange={(e) => setChecker(e.target.value)} onBlur={saveHeader} disabled={!jobOrderId} className={inputCls} />
        </div>
      </div>

      {jobOrderId && (
        <form onSubmit={addTruck} className="mb-4 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">Add truck {trucks.length + 1}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.span === 2 ? 'col-span-2' : ''}>
                <label className={labelCls}>{f.label}</label>
                <input type={f.type} value={form[f.key] ?? ''} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  min={f.type === 'number' ? 0 : undefined} step={f.type === 'number' ? 'any' : undefined} className={inputCls} />
              </div>
            ))}
            <div className="col-span-2 flex items-end">
              <button type="submit" disabled={saving} className="w-full rounded bg-brand-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {saving ? '…' : 'Record truck'}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-2 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">Plate / seal</th>
              <th className="px-2 py-2 text-left">Farm / house</th>
              <th className={th}>Farm count</th>
              <th className={th}>Plant count</th>
              <th className={th}>DOA</th>
              <th className={th}>Coops</th>
              <th className={th}>Plant kg</th>
              <th className="px-2 py-2 text-left">Arrive / hang</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {trucks.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-xs text-slate-400">{jobOrderId ? 'No trucks recorded for this batch yet.' : 'Pick a batch.'}</td></tr>
            ) : trucks.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-2 py-1.5 text-xs font-medium">{t.seq}</td>
                <td className="px-2 py-1.5 text-xs">{t.plate_no ?? '—'}<div className="text-[11px] text-slate-400">{t.seal_no}</div></td>
                <td className="px-2 py-1.5 text-xs">{t.farm_name ?? '—'}<div className="text-[11px] text-slate-400">{t.house_no}</div></td>
                <td className={td}>{n2(t.farm_count)}</td>
                <td className={td}>{n2(t.head_count)}</td>
                <td className={`${td} text-red-600`}>{t.doa_count || 0}</td>
                <td className={td}>{n2(t.coop_count)}</td>
                <td className={`${td} font-medium`}>{n2(t.net_live_weight_kg)}</td>
                <td className="px-2 py-1.5 text-xs text-slate-600 dark:text-slate-400">{t.plant_arrival ?? '—'} · {t.start_hang ?? '—'}–{t.end_hang ?? '—'}</td>
                <td className="px-2 py-1.5 text-right"><button onClick={() => removeTruck(t)} className="text-xs text-red-500 hover:underline">✕</button></td>
              </tr>
            ))}
          </tbody>
          {trucks.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <td className="px-2 py-2" colSpan={3}>TOTAL — {trucks.length} trucks</td>
                <td className={td}>{tot.farm.toLocaleString()}</td>
                <td className={td}>{tot.plant.toLocaleString()}</td>
                <td className={`${td} text-red-600`}>{tot.doa}</td>
                <td className={td}>{tot.coops.toLocaleString()}</td>
                <td className={td}>{n2(tot.kg)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {jobOrderId && trucks.length > 0 && (
        <div className="mt-3 flex justify-end">
          <button onClick={complete} className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Receiving complete</button>
        </div>
      )}
    </div>
  );
}
