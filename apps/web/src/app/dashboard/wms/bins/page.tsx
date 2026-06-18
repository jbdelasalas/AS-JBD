'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Warehouse { id: string; name: string; }
interface Bin {
  id: string; code: string; zone: string | null; bin_type: string;
  is_active: boolean; warehouse_id: string; warehouse_name: string;
}

const BIN_TYPES = ['receiving', 'storage', 'picking', 'staging', 'shipping'];

export default function BinsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-bin form
  const [warehouseId, setWarehouseId] = useState('');
  const [code, setCode] = useState('');
  const [zone, setZone] = useState('');
  const [binType, setBinType] = useState('storage');
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: Bin[] }>(`/wms/bins?company_id=${companyId}`)
      .then((r) => setBins(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: Warehouse[] }>(`/wms/warehouses?company_id=${companyId}`)
      .then((r) => { setWarehouses(r.data); if (r.data[0]) setWarehouseId(r.data[0].id); })
      .catch(() => {});
    load();
  }, [companyId, load]);

  async function addBin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId || !warehouseId || !code.trim()) { setError('Warehouse and code are required'); return; }
    setSaving(true);
    try {
      await api.post('/wms/bins', { company_id: companyId, warehouse_id: warehouseId, code, zone, bin_type: binType });
      setCode(''); setZone('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  }

  async function toggleActive(b: Bin) {
    await api.patch(`/wms/bins/${b.id}`, { is_active: !b.is_active }).catch((e) => setError((e as Error).message));
    load();
  }

  async function removeBin(b: Bin) {
    if (!confirm(`Delete bin ${b.code}?`)) return;
    try { await api.delete(`/wms/bins/${b.id}`); load(); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Bins</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Storage locations inside each warehouse.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={addBin} className="mb-5 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-4">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Warehouse *</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="col-span-3">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Code *</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A-01-01"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Zone</label>
          <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="A"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Type</label>
          <select value={binType} onChange={(e) => setBinType(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {BIN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="col-span-1 flex items-end">
          <button type="submit" disabled={saving}
            className="w-full rounded bg-brand-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">+</button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Warehouse</th>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Zone</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : bins.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">No bins yet. Add one above.</td></tr>
            ) : bins.map((b) => (
              <tr key={b.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{b.warehouse_name}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{b.code}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{b.zone ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{b.bin_type}</td>
                <td className="px-3 py-2">
                  <button onClick={() => toggleActive(b)}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium ${b.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {b.is_active ? 'active' : 'inactive'}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => removeBin(b)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
