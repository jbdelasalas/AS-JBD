'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface JobOrder { id: string; batch_no: string; client_name: string; locked: boolean; }
interface Receiving {
  id: string; batch_no: string; client_name: string;
  gross_weight_kg: string; tare_weight_kg: string; net_live_weight_kg: string;
  coop_count: number; head_count: number; doa_count: number; received_at: string;
}

export default function ReceivingPage() {
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [rows, setRows] = useState<Receiving[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [jobOrderId, setJobOrderId] = useState('');
  const [gross, setGross] = useState('');
  const [tare, setTare] = useState('');
  const [heads, setHeads] = useState('');
  const [coops, setCoops] = useState('');
  const [doa, setDoa] = useState('');
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: Receiving[] }>(`/dressing-plant/receiving?company_id=${companyId}`)
      .then((r) => setRows(r.data)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: JobOrder[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => {
        setOrders(r.data);
        const batch = new URLSearchParams(window.location.search).get('batch');
        setJobOrderId(batch && r.data.some((o) => o.id === batch) ? batch : (r.data[0]?.id ?? ''));
      })
      .catch(() => {});
    load();
  }, [companyId, load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!jobOrderId || !(Number(gross) > 0) || !(Number(heads) > 0)) { setError('Batch, gross weight and head count are required'); return; }
    setSaving(true);
    try {
      await api.post('/dressing-plant/receiving', {
        job_order_id: jobOrderId, gross_weight_kg: Number(gross),
        tare_weight_kg: tare ? Number(tare) : 0, head_count: Number(heads),
        coop_count: coops ? Number(coops) : 0, doa_count: doa ? Number(doa) : 0,
      });
      setGross(''); setTare(''); setHeads(''); setCoops(''); setDoa('');
      load();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Receiving &amp; Weighing</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Live-bird receiving. Recording it locks the batch (no journal entry). Net live weight = gross − tare.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={submit} className="mb-5 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-12 sm:col-span-4">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Batch *</label>
          <select value={jobOrderId} onChange={(e) => setJobOrderId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {orders.length === 0 && <option value="">No batches yet</option>}
            {orders.map((o) => <option key={o.id} value={o.id}>{o.batch_no} — {o.client_name}</option>)}
          </select>
        </div>
        {[['Gross kg *', gross, setGross], ['Tare kg', tare, setTare], ['Heads *', heads, setHeads], ['Coops', coops, setCoops], ['DOA', doa, setDoa]].map(
          ([label, val, set], i) => (
            <div key={i} className="col-span-4 sm:col-span-1">
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">{label as string}</label>
              <input value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} type="number" min="0" step="0.01"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          ),
        )}
        <div className="col-span-12 sm:col-span-3 flex items-end">
          <button type="submit" disabled={saving || !jobOrderId}
            className="w-full rounded bg-brand-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? '…' : 'Record receiving'}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Batch</th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-right">Gross</th>
              <th className="px-3 py-2 text-right">Tare</th>
              <th className="px-3 py-2 text-right">Net live</th>
              <th className="px-3 py-2 text-right">Heads</th>
              <th className="px-3 py-2 text-right">DOA</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">No receiving records yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{r.batch_no}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{r.client_name}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{Number(r.gross_weight_kg).toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{Number(r.tare_weight_kg).toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-xs font-medium text-slate-900 dark:text-slate-100">{Number(r.net_live_weight_kg).toLocaleString()} kg</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{r.head_count}</td>
                <td className="px-3 py-2 text-right text-xs text-red-600">{r.doa_count || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
