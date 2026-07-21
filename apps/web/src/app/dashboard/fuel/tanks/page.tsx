'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Warehouse { id: string; name: string; }
interface Item { id: string; name: string; sku?: string; }
interface Tank {
  id: string;
  tank_no: string;
  tank_name: string | null;
  capacity_litres: string;
  safe_fill_litres: string | null;
  dead_stock_litres: string;
  is_active: boolean;
  warehouse_id: string;
  warehouse_name: string;
  item_id: string;
  item_name: string;
  item_code: string | null;
  last_observed_litres: string | null;
  last_reading_at: string | null;
}

function fmtL(v: string | null): string {
  if (v == null) return '—';
  return `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} L`;
}

export default function FuelTanksPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-tank form
  const [warehouseId, setWarehouseId] = useState('');
  const [itemId, setItemId] = useState('');
  const [tankNo, setTankNo] = useState('');
  const [tankName, setTankName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [deadStock, setDeadStock] = useState('');
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: Tank[] }>(`/fuel/tanks?company_id=${companyId}`)
      .then((r) => setTanks(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: Warehouse[] }>(`/wms/warehouses?company_id=${companyId}`)
      .then((r) => { setWarehouses(r.data); if (r.data[0]) setWarehouseId(r.data[0].id); })
      .catch(() => {});
    api.get<Item[]>(`/wms/items?company_id=${companyId}`)
      .then((r) => { setItems(r); if (r[0]) setItemId(r[0].id); })
      .catch(() => {});
    load();
  }, [companyId, load]);

  async function addTank(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId || !warehouseId || !itemId || !tankNo.trim() || !capacity) {
      setError('Warehouse, fuel product, tank no. and capacity are required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/fuel/tanks', {
        company_id: companyId,
        warehouse_id: warehouseId,
        item_id: itemId,
        tank_no: tankNo,
        tank_name: tankName || null,
        capacity_litres: Number(capacity),
        dead_stock_litres: deadStock ? Number(deadStock) : 0,
      });
      setTankNo(''); setTankName(''); setCapacity(''); setDeadStock('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Fuel Tanks</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Storage tanks per warehouse. Each tank holds one fuel product.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={addTank} className="mb-5 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-6 sm:col-span-3">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Warehouse *</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Fuel product *</label>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div className="col-span-4 sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Tank no. *</label>
          <input value={tankNo} onChange={(e) => setTankNo(e.target.value)} placeholder="T-01"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-4 sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Capacity (L) *</label>
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" min="0" step="0.01" placeholder="30000"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-4 sm:col-span-2 flex items-end">
          <button type="submit" disabled={saving}
            className="w-full rounded bg-brand-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? '…' : '+ Add'}
          </button>
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Tank name</label>
          <input value={tankName} onChange={(e) => setTankName(e.target.value)} placeholder="Diesel main"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Dead stock (L)</label>
          <input value={deadStock} onChange={(e) => setDeadStock(e.target.value)} type="number" min="0" step="0.01" placeholder="500"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Tank</th>
              <th className="px-3 py-2 text-left">Warehouse</th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-right">Capacity</th>
              <th className="px-3 py-2 text-right">Last dip</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : tanks.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">No tanks yet. Add one above.</td></tr>
            ) : tanks.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{t.tank_no}</span>
                  {t.tank_name && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{t.tank_name}</span>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{t.warehouse_name}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{t.item_name}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{fmtL(t.capacity_litres)}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{fmtL(t.last_observed_litres)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${t.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {t.is_active ? 'active' : 'inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
