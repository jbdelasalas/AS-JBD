'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Box { id: string; box_uuid: string; product: string; net_weight_kg: string; batch_no: string; }
interface DeliveryOrder { id: string; do_no: string; status: string; client_name: string; batch_no: string | null; box_count: number; }
interface Client { id: string; code: string; name: string; }
interface GatePass { id: string; gate_pass_no: string; accounting_status: string; boxes_expected: number; boxes_scanned: number; do_no: string; client_name: string; }

export default function DispatchPage() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [dos, setDos] = useState<DeliveryOrder[]>([]);
  const [passes, setPasses] = useState<GatePass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [clientId, setClientId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    Promise.all([
      api.get<{ data: Box[] }>(`/dressing-plant/cold-chain?company_id=${companyId}&status=in_storage`),
      api.get<{ data: DeliveryOrder[] }>(`/dressing-plant/delivery-orders?company_id=${companyId}`),
      api.get<{ data: GatePass[] }>(`/dressing-plant/gate-passes?company_id=${companyId}`),
    ]).then(([b, d, g]) => { setBoxes(b.data); setDos(d.data); setPasses(g.data); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: Client[] }>(`/dressing-plant/clients?company_id=${companyId}`)
      .then((r) => { setClients(r.data); if (r.data[0]) setClientId(r.data[0].id); }).catch(() => {});
    load();
  }, [companyId, load]);

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function createDO(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setNotice(null);
    if (!clientId || selected.size === 0) { setError('Pick a client and at least one box'); return; }
    setSaving(true);
    try {
      const r = await api.post<{ do_no: string }>('/dressing-plant/delivery-orders', {
        company_id: companyId, client_id: clientId, box_ids: [...selected],
      });
      setNotice(`Delivery order ${r.do_no} created with ${selected.size} box(es).`);
      setSelected(new Set());
      load();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function issuePass(deliveryOrder: DeliveryOrder) {
    setError(null); setNotice(null);
    try {
      const r = await api.post<{ gate_pass_no: string }>('/dressing-plant/gate-passes', {
        company_id: companyId, do_id: deliveryOrder.id, boxes_scanned: deliveryOrder.box_count,
      });
      setNotice(`Gate pass ${r.gate_pass_no} issued — boxes released.`);
      load();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Dispatch &amp; Gate</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Bundle boxes into a delivery order, then issue a gate pass. Release is blocked until the batch&rsquo;s invoices clear and all boxes scan.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>}

      {/* Build a delivery order from in-storage boxes */}
      <form onSubmit={createDO} className="mb-5 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Client *</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={saving || selected.size === 0}
            className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? '…' : `Create DO (${selected.size})`}
          </button>
        </div>
        <div className="max-h-40 overflow-y-auto rounded border border-slate-100 dark:border-slate-800">
          {boxes.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-slate-400">No boxes in storage.</div>
          ) : boxes.map((b) => (
            <label key={b.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-50 px-3 py-1.5 text-xs last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
              <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
              <span className="font-mono text-slate-500">{b.box_uuid.slice(0, 8)}…</span>
              <span className="font-mono text-slate-900 dark:text-slate-100">{b.batch_no}</span>
              <span className="text-slate-600 dark:text-slate-300">{b.product}</span>
              <span className="ml-auto text-slate-500">{Number(b.net_weight_kg).toLocaleString()} kg</span>
            </label>
          ))}
        </div>
      </form>

      {/* Delivery orders awaiting a gate pass */}
      <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Delivery Orders</h2>
      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">DO</th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-right">Boxes</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : dos.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">No delivery orders yet.</td></tr>
            ) : dos.map((d) => (
              <tr key={d.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{d.do_no}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{d.client_name}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{d.box_count}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${d.status === 'released' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{d.status}</span></td>
                <td className="px-3 py-2 text-right">
                  {d.status !== 'released' && (
                    <button onClick={() => issuePass(d)} className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                      Issue gate pass
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Issued gate passes */}
      <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Gate Passes</h2>
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Gate pass</th>
              <th className="px-3 py-2 text-left">DO</th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-right">Scanned</th>
              <th className="px-3 py-2 text-left">Accounting</th>
            </tr>
          </thead>
          <tbody>
            {passes.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">No gate passes issued yet.</td></tr>
            ) : passes.map((g) => (
              <tr key={g.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{g.gate_pass_no}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{g.do_no}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{g.client_name}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{g.boxes_scanned}/{g.boxes_expected}</td>
                <td className="px-3 py-2"><span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{g.accounting_status.replace(/_/g, ' ')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
