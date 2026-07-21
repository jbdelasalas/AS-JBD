'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Client { id: string; code: string; name: string; }
interface JobOrder {
  id: string;
  batch_no: string;
  status: string;
  received_at: string;
  locked: boolean;
  client_name: string;
  client_code: string;
  net_live_weight_kg: string | null;
  head_count: number | null;
  doa_count: number | null;
  recovery_pct: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  received: 'bg-slate-200 text-slate-700',
  processing: 'bg-blue-100 text-blue-700',
  ready_to_invoice: 'bg-amber-100 text-amber-700',
  invoiced: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-300 text-slate-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function JobOrdersPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Inline new-client fields (a job order needs a client).
  const [showClient, setShowClient] = useState(false);
  const [newClientCode, setNewClientCode] = useState('');
  const [newClientName, setNewClientName] = useState('');

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: JobOrder[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => setOrders(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  const loadClients = useCallback(() => {
    if (!companyId) return;
    api.get<{ data: Client[] }>(`/dressing-plant/clients?company_id=${companyId}`)
      .then((r) => { setClients(r.data); if (r.data[0] && !clientId) setClientId(r.data[0].id); })
      .catch(() => {});
  }, [companyId, clientId]);

  useEffect(() => { loadClients(); load(); }, [loadClients, load]);

  async function addClient(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId || !newClientCode.trim() || !newClientName.trim()) return;
    setError(null);
    try {
      const r = await api.post<{ id: string }>('/dressing-plant/clients', {
        company_id: companyId, code: newClientCode, name: newClientName,
      });
      setNewClientCode(''); setNewClientName(''); setShowClient(false);
      setClientId(r.id);
      loadClients();
    } catch (e) { setError((e as Error).message); }
  }

  async function addOrder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId || !clientId) { setError('Select a tolling client first'); return; }
    setSaving(true);
    try {
      await api.post('/dressing-plant/job-orders', { company_id: companyId, client_id: clientId, notes: notes || null });
      setNotes('');
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Job Orders</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">The batch. A batch number is allocated automatically; everything downstream keys off it.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={addOrder} className="mb-5 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-12 sm:col-span-4">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Tolling client *</label>
          <div className="flex gap-2">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              {clients.length === 0 && <option value="">No clients yet</option>}
              {clients.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
            <button type="button" onClick={() => setShowClient((s) => !s)}
              className="shrink-0 rounded border border-slate-300 px-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">+</button>
          </div>
        </div>
        <div className="col-span-8 sm:col-span-5">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-4 sm:col-span-3 flex items-end">
          <button type="submit" disabled={saving || !clientId}
            className="w-full rounded bg-brand-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? '…' : '+ New batch'}
          </button>
        </div>

        {showClient && (
          <div className="col-span-12 mt-1 flex flex-wrap items-end gap-2 rounded border border-dashed border-slate-300 p-2 dark:border-slate-600">
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Client code</label>
              <input value={newClientCode} onChange={(e) => setNewClientCode(e.target.value)} placeholder="GOLD"
                className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Client name</label>
              <input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Gold Broilers Corp"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <button type="button" onClick={addClient}
              className="rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">Add client</button>
          </div>
        )}
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Batch</th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-right">Live wt</th>
              <th className="px-3 py-2 text-right">Heads</th>
              <th className="px-3 py-2 text-right">Recovery</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">No job orders yet. Create one above.</td></tr>
            ) : orders.map((o) => (
              <tr key={o.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/dressing-plant/receiving?batch=${o.id}`} className="font-mono text-xs text-brand-600 hover:underline dark:text-brand-400">{o.batch_no}</Link>
                  {o.locked && <span className="ml-2 text-[11px] text-slate-400">🔒</span>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{o.client_name}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{o.net_live_weight_kg ? `${Number(o.net_live_weight_kg).toLocaleString()} kg` : '—'}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{o.head_count ?? '—'}{o.doa_count ? <span className="text-red-500"> (−{o.doa_count})</span> : null}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{o.recovery_pct != null ? `${Number(o.recovery_pct).toFixed(1)}%` : '—'}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[o.status] ?? 'bg-slate-200 text-slate-600'}`}>{o.status.replace(/_/g, ' ')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
