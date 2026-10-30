'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { BIN_TYPES, BIN_ZONES, RACKS, LEVELS, LANES, zoneByCode, buildBinCode } from '@/lib/wms-bins';

interface Warehouse { id: string; name: string; }
interface Bin {
  id: string; code: string; zone: string | null; bin_type: string;
  is_active: boolean; warehouse_id: string; warehouse_name: string;
}

const sel = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const lbl = 'mb-1 block text-xs text-slate-600 dark:text-slate-400';

export default function BinsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-bin form
  const [warehouseId, setWarehouseId] = useState('');
  const [zone, setZone] = useState('CHL');
  const [rack, setRack] = useState(RACKS[0]);
  const [level, setLevel] = useState(LEVELS[0]);
  const [lane, setLane] = useState(LANES[0]);
  const [binType, setBinType] = useState<string>(zoneByCode('CHL')!.binType);
  const [saving, setSaving] = useState(false);

  const isDock = zoneByCode(zone)?.dock ?? false;
  const code = buildBinCode(zone, { rack, level, lane });

  function pickZone(z: string) {
    setZone(z);
    setBinType(zoneByCode(z)?.binType ?? 'storage');
  }

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
    if (!companyId || !warehouseId || !code) { setError('Warehouse, zone and location are required'); return; }
    setSaving(true);
    try {
      await api.post('/wms/bins', { company_id: companyId, warehouse_id: warehouseId, zone, rack, level, lane, bin_type: binType });
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
        <div className="col-span-3">
          <label className={lbl}>Warehouse *</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={sel}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="col-span-3">
          <label className={lbl}>Zone *</label>
          <select value={zone} onChange={(e) => pickZone(e.target.value)} className={sel}>
            {BIN_ZONES.map((z) => <option key={z.code} value={z.code}>{z.code} — {z.label}</option>)}
          </select>
        </div>
        {isDock ? (
          <div className="col-span-2">
            <label className={lbl}>Lane *</label>
            <select value={lane} onChange={(e) => setLane(e.target.value)} className={sel}>
              {LANES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        ) : (
          <>
            <div className="col-span-1">
              <label className={lbl}>Rack *</label>
              <select value={rack} onChange={(e) => setRack(e.target.value)} className={sel}>
                {RACKS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="col-span-1">
              <label className={lbl} title="L1 = floor">Level *</label>
              <select value={level} onChange={(e) => setLevel(e.target.value)} className={sel}>
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </>
        )}
        <div className="col-span-2">
          <label className={lbl}>Type</label>
          <select value={binType} onChange={(e) => setBinType(e.target.value)} className={sel}>
            {BIN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="col-span-2 flex items-end gap-2">
          <span className="flex-1 truncate rounded bg-slate-100 px-2 py-1.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            title="Bin code">{code ?? '—'}</span>
          <button type="submit" disabled={saving || !code}
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">+</button>
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
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{zoneByCode(b.zone)?.label ?? b.zone ?? '—'}</td>
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
