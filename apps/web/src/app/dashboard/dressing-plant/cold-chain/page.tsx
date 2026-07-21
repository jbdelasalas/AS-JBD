'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface JobOrder { id: string; batch_no: string; client_name: string; }
interface Box {
  id: string; box_uuid: string; product: string; net_weight_kg: string;
  pallet: string | null; room: string | null; time_in: string; status: string;
  batch_no: string; accrued_amount: string;
}

export default function ColdChainPage() {
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [rows, setRows] = useState<Box[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clockMsg, setClockMsg] = useState<string | null>(null);

  const [jobOrderId, setJobOrderId] = useState('');
  const [product, setProduct] = useState('');
  const [weight, setWeight] = useState('');
  const [pallet, setPallet] = useState('');
  const [room, setRoom] = useState('');
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: Box[] }>(`/dressing-plant/cold-chain?company_id=${companyId}`)
      .then((r) => setRows(r.data)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: JobOrder[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => { setOrders(r.data); if (r.data[0]) setJobOrderId(r.data[0].id); }).catch(() => {});
    load();
  }, [companyId, load]);

  async function addBox(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!jobOrderId || !product.trim() || !(Number(weight) > 0)) { setError('Batch, product and weight are required'); return; }
    setSaving(true);
    try {
      await api.post('/dressing-plant/cold-chain', {
        company_id: companyId, job_order_id: jobOrderId, product,
        net_weight_kg: Number(weight), pallet: pallet || null, room: room || null,
      });
      setProduct(''); setWeight(''); setPallet(''); setRoom('');
      load();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function runClock() {
    setClockMsg(null); setError(null);
    try {
      const r = await api.post<{ rows_written: number }>('/dressing-plant/cold-chain/run-clock', { company_id: companyId });
      setClockMsg(`Storage clock ran — ${r.rows_written} daily accrual row(s) written.`);
      load();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Cold Chain</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Storage boxes carry a barcode UUID (CCPT label). The storage clock accrues daily rental for boxes held over 24h.</p>
        </div>
        <button onClick={runClock} className="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
          Run storage clock
        </button>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {clockMsg && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{clockMsg}</div>}

      <form onSubmit={addBox} className="mb-5 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-12 sm:col-span-3">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Batch *</label>
          <select value={jobOrderId} onChange={(e) => setJobOrderId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {orders.length === 0 && <option value="">No batches yet</option>}
            {orders.map((o) => <option key={o.id} value={o.id}>{o.batch_no} — {o.client_name}</option>)}
          </select>
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Product *</label>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Whole dressed"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-6 sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Net kg *</label>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} type="number" min="0" step="0.01"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-4 sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Pallet</label>
          <input value={pallet} onChange={(e) => setPallet(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-4 sm:col-span-1">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Room</label>
          <input value={room} onChange={(e) => setRoom(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-4 sm:col-span-1 flex items-end">
          <button type="submit" disabled={saving || !jobOrderId}
            className="w-full rounded bg-brand-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? '…' : 'Store'}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Box UUID</th>
              <th className="px-3 py-2 text-left">Batch</th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-right">Net kg</th>
              <th className="px-3 py-2 text-left">Room / Pallet</th>
              <th className="px-3 py-2 text-right">Accrued</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">No boxes in storage yet.</td></tr>
            ) : rows.map((b) => (
              <tr key={b.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">{b.box_uuid.slice(0, 8)}…</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{b.batch_no}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{b.product}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{Number(b.net_weight_kg).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{[b.room, b.pallet].filter(Boolean).join(' / ') || '—'}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">₱{Number(b.accrued_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${b.status === 'in_storage' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>{b.status.replace(/_/g, ' ')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
