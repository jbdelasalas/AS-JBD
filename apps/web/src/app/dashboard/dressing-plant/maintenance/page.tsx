'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Asset { id: string; code: string; name: string; current_runtime_hours: string; next_service_threshold_hours: string | null; hours_to_service: string | null; }
interface WorkOrder { id: string; wo_no: string; wo_type: string; status: string; description: string; asset_name: string | null; parts_cost: string; labor_cost: string; }
interface Sanitation { id: string; area: string; item_name: string | null; qty: string; unit_cost: string; consumption_posted: boolean; }

export default function MaintenancePage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [sanitation, setSanitation] = useState<Sanitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Work order form
  const [assetId, setAssetId] = useState('');
  const [woType, setWoType] = useState('corrective');
  const [woDesc, setWoDesc] = useState('');
  const [partsCost, setPartsCost] = useState('');
  const [savingWO, setSavingWO] = useState(false);

  // Sanitation form
  const [area, setArea] = useState('');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [savingSan, setSavingSan] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    Promise.all([
      api.get<{ data: Asset[] }>(`/dressing-plant/assets?company_id=${companyId}`),
      api.get<{ data: WorkOrder[] }>(`/dressing-plant/work-orders?company_id=${companyId}`),
      api.get<{ data: Sanitation[] }>(`/dressing-plant/sanitation?company_id=${companyId}`),
    ]).then(([a, w, s]) => { setAssets(a.data); if (a.data[0]) setAssetId(a.data[0].id); setWorkOrders(w.data); setSanitation(s.data); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  async function addWO(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!woDesc.trim()) { setError('Work order description is required'); return; }
    setSavingWO(true);
    try {
      await api.post('/dressing-plant/work-orders', {
        company_id: companyId, asset_id: assetId || null, wo_type: woType,
        description: woDesc, parts_cost: partsCost ? Number(partsCost) : 0,
      });
      setWoDesc(''); setPartsCost('');
      load();
    } catch (e) { setError((e as Error).message); } finally { setSavingWO(false); }
  }

  async function addSan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!area.trim()) { setError('Sanitation area is required'); return; }
    setSavingSan(true);
    try {
      await api.post('/dressing-plant/sanitation', {
        company_id: companyId, area, qty: qty ? Number(qty) : 0, unit_cost: unitCost ? Number(unitCost) : 0,
      });
      setArea(''); setQty(''); setUnitCost('');
      load();
    } catch (e) { setError((e as Error).message); } finally { setSavingSan(false); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Sanitation &amp; PM</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Machinery runtime &amp; maintenance work orders, plus sanitation chemical consumption (posts Dr 5230 / Cr 1140).</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {/* Machinery + PM status */}
      <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Machinery — service status</h2>
      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Asset</th>
              <th className="px-3 py-2 text-right">Runtime hrs</th>
              <th className="px-3 py-2 text-right">Service at</th>
              <th className="px-3 py-2 text-right">Hours to service</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : assets.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-400">No machinery registered. POST to /dressing-plant/assets to add.</td></tr>
            ) : assets.map((a) => {
              const hrs = a.hours_to_service != null ? Number(a.hours_to_service) : null;
              const due = hrs != null && hrs <= 48;
              return (
                <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-xs text-slate-900 dark:text-slate-100"><span className="font-mono">{a.code}</span> — {a.name}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{Number(a.current_runtime_hours).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{a.next_service_threshold_hours ? Number(a.next_service_threshold_hours).toLocaleString() : '—'}</td>
                  <td className={`px-3 py-2 text-right text-xs font-medium ${due ? 'text-red-600' : 'text-slate-700 dark:text-slate-300'}`}>{hrs != null ? `${hrs.toLocaleString()}${due ? ' ⚠' : ''}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Work orders */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Work Orders</h2>
          <form onSubmit={addWO} className="mb-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex gap-2">
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)}
                className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">No asset</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
              </select>
              <select value={woType} onChange={(e) => setWoType(e.target.value)}
                className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="corrective">Corrective</option>
                <option value="preventive">Preventive</option>
              </select>
            </div>
            <input value={woDesc} onChange={(e) => setWoDesc(e.target.value)} placeholder="Description *"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            <div className="flex gap-2">
              <input value={partsCost} onChange={(e) => setPartsCost(e.target.value)} type="number" min="0" step="0.01" placeholder="Parts cost"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              <button type="submit" disabled={savingWO}
                className="shrink-0 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{savingWO ? '…' : '+ WO'}</button>
            </div>
          </form>
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr><th className="px-3 py-2 text-left">WO</th><th className="px-3 py-2 text-left">Asset</th><th className="px-3 py-2 text-left">Status</th></tr>
              </thead>
              <tbody>
                {workOrders.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-4 text-center text-xs text-slate-400">No work orders.</td></tr>
                ) : workOrders.map((w) => (
                  <tr key={w.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{w.wo_no}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{w.asset_name ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{w.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sanitation */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Sanitation Logs</h2>
          <form onSubmit={addSan} className="mb-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Area (e.g. Kill floor) *"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            <div className="flex gap-2">
              <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="0" step="0.01" placeholder="Qty"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              <input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} type="number" min="0" step="0.01" placeholder="Unit cost"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              <button type="submit" disabled={savingSan}
                className="shrink-0 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{savingSan ? '…' : '+ Log'}</button>
            </div>
          </form>
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr><th className="px-3 py-2 text-left">Area</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-left">Posted</th></tr>
              </thead>
              <tbody>
                {sanitation.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-4 text-center text-xs text-slate-400">No sanitation logs.</td></tr>
                ) : sanitation.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{s.area}</td>
                    <td className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-300">{Number(s.qty).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs">{s.consumption_posted ? <span className="text-emerald-600">✓</span> : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
