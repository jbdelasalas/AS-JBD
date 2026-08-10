'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Employee { id: string; employee_no: string; full_name: string; }
interface Vehicle {
  id: string;
  plate_no: string;
  description: string | null;
  vehicle_type: string | null;
  default_product: string | null;
  tank_capacity_l: string | null;
  is_active: boolean;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  last_odometer_km: string | null;
}

const TYPES = ['truck', 'van', 'motorcycle', 'car', 'genset', 'other'];
const PRODUCTS = ['diesel', 'gasoline', 'premium', 'kerosene'];

const inputCls =
  'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const labelCls = 'mb-1 block text-xs text-slate-600 dark:text-slate-400';

function fmt(v: string | null, suffix: string): string {
  if (v == null) return '—';
  return `${Number(v).toLocaleString('en-PH', { maximumFractionDigits: 0 })} ${suffix}`;
}

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [plateNo, setPlateNo] = useState('');
  const [description, setDescription] = useState('');
  const [vehicleType, setVehicleType] = useState('truck');
  const [defaultProduct, setDefaultProduct] = useState('diesel');
  const [tankCapacity, setTankCapacity] = useState('');
  const [assignedTo, setAssignedTo] = useState('');

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: Vehicle[] }>(`/fuel/vehicles?company_id=${companyId}`)
      .then((r) => setVehicles(r.data))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<Employee[]>(`/admin/employees?company_id=${companyId}`).then(setEmployees).catch(() => {});
    load();
  }, [companyId, load]);

  async function addVehicle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId || !plateNo.trim()) { setError('Plate no. is required'); return; }
    setSaving(true);
    try {
      await api.post('/fuel/vehicles', {
        company_id: companyId,
        plate_no: plateNo,
        description: description || null,
        vehicle_type: vehicleType,
        default_product: defaultProduct,
        tank_capacity_l: tankCapacity || null,
        assigned_employee_id: assignedTo || null,
      });
      setPlateNo(''); setDescription(''); setTankCapacity(''); setAssignedTo('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(v: Vehicle) {
    setError(null);
    try {
      await api.put(`/fuel/vehicles/${v.id}`, {
        plate_no: v.plate_no,
        description: v.description,
        vehicle_type: v.vehicle_type,
        default_product: v.default_product,
        tank_capacity_l: v.tank_capacity_l,
        assigned_employee_id: v.assigned_employee_id,
        is_active: !v.is_active,
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Vehicles</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Company units that gas P.O. slips are issued against. Slips can still name a rented plate not listed here.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <form onSubmit={addVehicle} className="mb-5 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-6 sm:col-span-2">
          <label className={labelCls}>Plate no. *</label>
          <input value={plateNo} onChange={(e) => setPlateNo(e.target.value.toUpperCase())} placeholder="NJH 4714" className={`${inputCls} font-mono`} />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className={labelCls}>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Isuzu Elf — delivery" className={inputCls} />
        </div>
        <div className="col-span-4 sm:col-span-2">
          <label className={labelCls}>Type</label>
          <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className={`${inputCls} capitalize`}>
            {TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
          </select>
        </div>
        <div className="col-span-4 sm:col-span-2">
          <label className={labelCls}>Default product</label>
          <select value={defaultProduct} onChange={(e) => setDefaultProduct(e.target.value)} className={`${inputCls} capitalize`}>
            {PRODUCTS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
          </select>
        </div>
        <div className="col-span-4 sm:col-span-2">
          <label className={labelCls}>Tank cap. (L)</label>
          <input type="number" min="0" step="0.01" value={tankCapacity} onChange={(e) => setTankCapacity(e.target.value)} placeholder="80" className={inputCls} />
        </div>
        <div className="col-span-8 sm:col-span-3">
          <label className={labelCls}>Assigned to</label>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={inputCls}>
            <option value="">— unassigned —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </div>
        <div className="col-span-4 sm:col-span-2 flex items-end">
          <button type="submit" disabled={saving} className="w-full rounded bg-brand-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? '…' : '+ Add'}
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Plate</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-right">Tank</th>
              <th className="px-3 py-2 text-left">Assigned to</th>
              <th className="px-3 py-2 text-right">Last odometer</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : vehicles.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400">No vehicles yet. Add one above.</td></tr>
            ) : vehicles.map((v) => (
              <tr key={v.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{v.plate_no}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{v.description ?? '—'}</td>
                <td className="px-3 py-2 text-xs capitalize text-slate-700 dark:text-slate-300">{v.vehicle_type ?? '—'}</td>
                <td className="px-3 py-2 text-xs capitalize text-slate-700 dark:text-slate-300">{v.default_product ?? '—'}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{fmt(v.tank_capacity_l, 'L')}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{v.assigned_employee_name ?? '—'}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{fmt(v.last_odometer_km, 'km')}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${v.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {v.is_active ? 'active' : 'inactive'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => toggleActive(v)} className="text-xs text-brand-600 hover:underline dark:text-brand-400">
                    {v.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
