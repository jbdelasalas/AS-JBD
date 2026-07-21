'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Tank { id: string; tank_no: string; tank_name: string | null; item_name: string; }
interface Supplier { id: string; name: string; }
interface Delivery {
  id: string;
  delivery_no: string;
  delivery_date: string;
  status: string;
  received_litres_15c: string;
  received_litres_obs: string;
  variance_litres: string | null;
  unit_cost: string | null;
  total_cost: string | null;
  truck_plate_no: string | null;
  bol_no: string | null;
  tank_no: string;
  item_name: string;
  supplier_name: string;
}

function fmtL(v: string | null): string {
  if (v == null) return '—';
  return `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} L`;
}
function fmtPHP(v: string | null): string {
  if (v == null) return '—';
  return Number(v).toLocaleString(undefined, { style: 'currency', currency: 'PHP' });
}
function fmtDate(v: string): string {
  return new Date(v).toLocaleDateString();
}

const today = () => new Date().toISOString().slice(0, 10);

export default function FuelDeliveriesPage() {
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // New-delivery form
  const [tankId, setTankId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(today());
  const [receivedL15, setReceivedL15] = useState('');
  const [receivedObs, setReceivedObs] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [truckPlate, setTruckPlate] = useState('');
  const [bolNo, setBolNo] = useState('');
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: Delivery[] }>(`/fuel/deliveries?company_id=${companyId}`)
      .then((r) => setDeliveries(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: Tank[] }>(`/fuel/tanks?company_id=${companyId}`)
      .then((r) => { setTanks(r.data); if (r.data[0]) setTankId(r.data[0].id); })
      .catch(() => {});
    api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${companyId}&minimal=true`)
      .then((r) => { setSuppliers(r.data); if (r.data[0]) setSupplierId(r.data[0].id); })
      .catch(() => {});
    load();
  }, [companyId, load]);

  async function recordDelivery(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId || !tankId || !supplierId || !receivedL15) {
      setError('Tank, supplier and received litres (L15) are required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/fuel/deliveries', {
        company_id: companyId,
        tank_id: tankId,
        supplier_id: supplierId,
        delivery_date: deliveryDate,
        received_litres_15c: Number(receivedL15),
        received_litres_obs: receivedObs ? Number(receivedObs) : undefined,
        unit_cost: unitCost ? Number(unitCost) : undefined,
        truck_plate_no: truckPlate || undefined,
        bol_no: bolNo || undefined,
      });
      setReceivedL15(''); setReceivedObs(''); setUnitCost(''); setTruckPlate(''); setBolNo('');
      setShowForm(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  }

  const noTanks = !loading && tanks.length === 0;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Fuel Deliveries</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Inbound fuel into a tank. Received litres at 15°C post to inventory at the unit cost entered.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          disabled={noTanks}
          className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {showForm ? 'Close' : '+ Record delivery'}
        </button>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {noTanks && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No tanks defined yet — add a tank first under Fuel → Tanks.
        </div>
      )}

      {showForm && !noTanks && (
        <form onSubmit={recordDelivery} className="mb-5 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="col-span-6 sm:col-span-4">
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Tank *</label>
            <select value={tankId} onChange={(e) => setTankId(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              {tanks.map((t) => <option key={t.id} value={t.id}>{t.tank_no} — {t.item_name}</option>)}
            </select>
          </div>
          <div className="col-span-6 sm:col-span-4">
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Supplier *</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="col-span-6 sm:col-span-4">
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Delivery date *</label>
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Received L15 *</label>
            <input type="number" min="0" step="0.01" value={receivedL15} onChange={(e) => setReceivedL15(e.target.value)} placeholder="20000"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Received (observed)</label>
            <input type="number" min="0" step="0.01" value={receivedObs} onChange={(e) => setReceivedObs(e.target.value)} placeholder="optional"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Unit cost / L</label>
            <input type="number" min="0" step="0.0001" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.0000"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div className="col-span-6 sm:col-span-3 flex items-end">
            <button type="submit" disabled={saving}
              className="w-full rounded bg-brand-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Posting…' : 'Post delivery'}
            </button>
          </div>
          <div className="col-span-6 sm:col-span-4">
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Truck plate</label>
            <input value={truckPlate} onChange={(e) => setTruckPlate(e.target.value)} placeholder="ABC-1234"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div className="col-span-6 sm:col-span-4">
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">BOL / withdrawal cert.</label>
            <input value={bolNo} onChange={(e) => setBolNo(e.target.value)} placeholder="BOL-…"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Delivery</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Tank / Product</th>
              <th className="px-3 py-2 text-left">Supplier</th>
              <th className="px-3 py-2 text-right">Received L15</th>
              <th className="px-3 py-2 text-right">Total cost</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : deliveries.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">No deliveries yet.</td></tr>
            ) : deliveries.map((d) => (
              <tr key={d.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{d.delivery_no}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{fmtDate(d.delivery_date)}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{d.tank_no} · {d.item_name}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{d.supplier_name}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{fmtL(d.received_litres_15c)}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{fmtPHP(d.total_cost)}</td>
                <td className="px-3 py-2">
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{d.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
