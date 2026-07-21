'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface JobOrder { id: string; batch_no: string; client_name: string; net_live_weight_kg: string | null; }
interface Yield {
  id: string; batch_no: string; client_name: string;
  net_live_weight_kg: string; dressed_recovery_weight_kg: string | null;
  offal_weight_kg: string; reject_condemned_weight_kg: string; recovery_pct: string | null;
}

export default function YieldPage() {
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [rows, setRows] = useState<Yield[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<string[]>([]);

  const [jobOrderId, setJobOrderId] = useState('');
  const [live, setLive] = useState('');
  const [dressed, setDressed] = useState('');
  const [offal, setOffal] = useState('');
  const [condemned, setCondemned] = useState('');
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: Yield[] }>(`/dressing-plant/yield?company_id=${companyId}`)
      .then((r) => setRows(r.data)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: JobOrder[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => { setOrders(r.data); if (r.data[0]) setJobOrderId(r.data[0].id); }).catch(() => {});
    load();
  }, [companyId, load]);

  // Prefill live weight from the selected batch's receiving.
  useEffect(() => {
    const o = orders.find((x) => x.id === jobOrderId);
    if (o?.net_live_weight_kg && !live) setLive(o.net_live_weight_kg);
  }, [jobOrderId, orders]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setAlerts([]);
    if (!jobOrderId || !(Number(live) > 0)) { setError('Batch and net live weight are required'); return; }
    setSaving(true);
    try {
      const r = await api.post<{ alerts: string[] }>('/dressing-plant/yield', {
        job_order_id: jobOrderId, net_live_weight_kg: Number(live),
        dressed_recovery_weight_kg: dressed ? Number(dressed) : null,
        offal_weight_kg: offal ? Number(offal) : 0,
        reject_condemned_weight_kg: condemned ? Number(condemned) : 0,
      });
      setAlerts(r.alerts ?? []);
      setDressed(''); setOffal(''); setCondemned('');
      load();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Yield &amp; WIP</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Dressed recovery, offal and condemned weight. Recovery % is computed live; mass-balance and recovery alerts fire on save.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {alerts.length > 0 && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {alerts.map((a, i) => <div key={i}>⚠ {a}</div>)}
        </div>
      )}

      <form onSubmit={submit} className="mb-5 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-12 sm:col-span-4">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Batch *</label>
          <select value={jobOrderId} onChange={(e) => setJobOrderId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {orders.length === 0 && <option value="">No batches yet</option>}
            {orders.map((o) => <option key={o.id} value={o.id}>{o.batch_no} — {o.client_name}</option>)}
          </select>
        </div>
        {[['Net live kg *', live, setLive], ['Dressed kg', dressed, setDressed], ['Offal kg', offal, setOffal], ['Condemned kg', condemned, setCondemned]].map(
          ([label, val, set], i) => (
            <div key={i} className="col-span-6 sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">{label as string}</label>
              <input value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} type="number" min="0" step="0.01"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          ),
        )}
        <div className="col-span-12 flex items-end sm:col-span-12">
          <button type="submit" disabled={saving || !jobOrderId}
            className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? '…' : 'Record yield'}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Batch</th>
              <th className="px-3 py-2 text-right">Live</th>
              <th className="px-3 py-2 text-right">Dressed</th>
              <th className="px-3 py-2 text-right">Offal</th>
              <th className="px-3 py-2 text-right">Condemned</th>
              <th className="px-3 py-2 text-right">Recovery</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">No yield records yet.</td></tr>
            ) : rows.map((r) => {
              const rec = r.recovery_pct != null ? Number(r.recovery_pct) : null;
              return (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{r.batch_no}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{Number(r.net_live_weight_kg).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{r.dressed_recovery_weight_kg ? Number(r.dressed_recovery_weight_kg).toLocaleString() : <span className="text-slate-400">Processing…</span>}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{Number(r.offal_weight_kg).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{Number(r.reject_condemned_weight_kg).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-xs font-medium">
                    {rec != null ? <span className={rec < 75 ? 'text-red-600' : 'text-emerald-600'}>{rec.toFixed(1)}%</span> : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
