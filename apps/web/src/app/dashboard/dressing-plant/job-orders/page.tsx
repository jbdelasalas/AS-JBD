'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Customer { id: string; code: string; name: string; }
interface JobOrder {
  id: string;
  batch_no: string;
  status: string;
  received_at: string;
  locked: boolean;
  notes: string | null;
  farm_location: string | null;
  expected_arrival: string | null;
  expected_truck_plate: string | null;
  expected_heads: number | null;
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

const labelCls = 'mb-1 block text-sm text-slate-700 dark:text-slate-300';
const fieldCls = 'w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const roCls = 'w-full rounded border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60';

export default function JobOrdersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Booking form
  const [lastBookingNo, setLastBookingNo] = useState('');
  const [lastStatus, setLastStatus] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [farmLocation, setFarmLocation] = useState('');
  const [expectedArrival, setExpectedArrival] = useState('');
  const [truckPlate, setTruckPlate] = useState('');
  const [expectedHeads, setExpectedHeads] = useState('');
  const [remarks, setRemarks] = useState('');

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: JobOrder[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => setOrders(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  const loadCustomers = useCallback(() => {
    if (!companyId) return;
    // Bill To list is the ERP customer master.
    api.get<{ data: Customer[] }>(`/ar/customers?company_id=${companyId}&limit=500`)
      .then((r) => { setCustomers(r.data); setCustomerId((prev) => prev || r.data[0]?.id || ''); })
      .catch(() => {});
  }, [companyId]);

  useEffect(() => { loadCustomers(); load(); }, [loadCustomers, load]);

  function resetForm() {
    setFarmLocation(''); setExpectedArrival(''); setTruckPlate(''); setExpectedHeads(''); setRemarks('');
  }

  async function addOrder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId || !customerId) { setError('Select a Bill To customer first'); return; }
    setSaving(true);
    try {
      const r = await api.post<{ batch_no: string; status: string }>('/dressing-plant/job-orders', {
        company_id: companyId,
        customer_id: customerId,
        farm_location: farmLocation || null,
        expected_arrival: expectedArrival || null,
        expected_truck_plate: truckPlate || null,
        expected_heads: expectedHeads || null,
        notes: remarks || null,
      });
      setLastBookingNo(r.batch_no);
      setLastStatus(r.status);
      resetForm();
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Job Orders — Live Bird Receiving Booking</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Book an incoming batch. The Booking # is allocated automatically on save; everything downstream keys off it.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={addOrder} className="mb-6 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        {/* Booking # + Status (read-only, populated after save) */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Booking #:</label>
            <input value={lastBookingNo} readOnly placeholder="—" className={roCls} />
          </div>
          <div>
            <label className={labelCls}>Status:</label>
            <input value={lastStatus} readOnly placeholder="—" className={roCls} />
          </div>
        </div>

        {/* Bill To / Farm Location / Expected Arrival */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Bill To:</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={fieldCls}>
              {customers.length === 0 && <option value="">Select Customer</option>}
              {customers.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Farm Location:</label>
            <input value={farmLocation} onChange={(e) => setFarmLocation(e.target.value)} className={fieldCls} />
          </div>
          <div>
            <label className={labelCls}>Expected Arrival Date Time</label>
            <input type="datetime-local" value={expectedArrival} onChange={(e) => setExpectedArrival(e.target.value)} className={fieldCls} />
          </div>
        </div>

        {/* Expected Truck Plate / Expected Farm Count Heads */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Expected Truck Plate:</label>
            <input value={truckPlate} onChange={(e) => setTruckPlate(e.target.value)} className={fieldCls} />
          </div>
          <div>
            <label className={labelCls}>Expected Farm Count Heads:</label>
            <input type="number" min="0" value={expectedHeads} onChange={(e) => setExpectedHeads(e.target.value)} className={fieldCls} />
          </div>
        </div>

        {/* Booking Remarks */}
        <div className="mb-4 sm:max-w-md">
          <label className={labelCls}>Booking Remarks:</label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={fieldCls} />
        </div>

        <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
          <button type="submit" disabled={saving || !customerId}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : '+ Create Booking'}
          </button>
          {customers.length === 0 && (
            <span className="ml-3 text-xs text-slate-500 dark:text-slate-400">
              No customers yet — add them under Receivables → Customers.
            </span>
          )}
        </div>
      </form>

      <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Bookings</h2>
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Booking #</th>
              <th className="px-3 py-2 text-left">Bill To</th>
              <th className="px-3 py-2 text-left">Farm</th>
              <th className="px-3 py-2 text-right">Exp. heads</th>
              <th className="px-3 py-2 text-right">Live wt</th>
              <th className="px-3 py-2 text-right">Recovery</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">No bookings yet. Create one above.</td></tr>
            ) : orders.map((o) => (
              <tr key={o.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/dressing-plant/receiving?batch=${o.id}`} className="font-mono text-xs text-brand-600 hover:underline dark:text-brand-400">{o.batch_no}</Link>
                  {o.locked && <span className="ml-2 text-[11px] text-slate-400">🔒</span>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{o.client_name}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{o.farm_location ?? '—'}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-400">{o.expected_heads ?? '—'}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{o.net_live_weight_kg ? `${Number(o.net_live_weight_kg).toLocaleString()} kg` : '—'}</td>
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
