'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Row {
  group_key: string;
  label: string;
  sublabel: string | null;
  slip_count: number;
  total_litres: number;
  total_amount: number;
  total_km: number | null;
  avg_unit_price: number | null;
  avg_km_per_litre: number | null;
  last_slip_date: string | null;
}

interface Response {
  group_by: string;
  data: Row[];
  totals: { slip_count: number; total_litres: number; total_amount: number; total_km: number | null };
}

function fmt(n: number | null, dec = 2): string {
  if (n == null) return '—';
  return n.toLocaleString('en-PH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

const inputCls =
  'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const labelCls = 'mb-1 block text-xs text-slate-600 dark:text-slate-400';

export default function FuelConsumptionPage() {
  const [resp, setResp] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [groupBy, setGroupBy] = useState<'employee' | 'vehicle'>('employee');
  // Default to the current month — the usual review window for fuel spend.
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ company_id: companyId, group_by: groupBy });
    if (dateFrom) qs.set('date_from', dateFrom);
    if (dateTo) qs.set('date_to', dateTo);
    api.get<Response>(`/fuel/consumption?${qs}`)
      .then(setResp)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [companyId, groupBy, dateFrom, dateTo]);

  useEffect(load, [load]);

  const totals = resp?.totals;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Gas Consumption Report</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Redeemed slips only — authorised-but-unused slips are not counted as spend.
          </p>
        </div>
        <Link
          href="/dashboard/fuel/po-slips"
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          ← Back to slips
        </Link>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="mb-4 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-12 sm:col-span-4">
          <label className={labelCls}>Group by</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'employee' | 'vehicle')} className={inputCls}>
            <option value="employee">Employee</option>
            <option value="vehicle">Vehicle</option>
          </select>
        </div>
        <div className="col-span-6 sm:col-span-4">
          <label className={labelCls}>From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        </div>
        <div className="col-span-6 sm:col-span-4">
          <label className={labelCls}>To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        </div>
      </div>

      {totals && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Slips redeemed</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{totals.slip_count}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total litres</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{fmt(totals.total_litres)} L</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total amount</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">₱{fmt(totals.total_amount)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Distance covered</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {totals.total_km != null ? `${fmt(totals.total_km, 0)} km` : '—'}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">{groupBy === 'employee' ? 'Employee' : 'Vehicle'}</th>
              <th className="px-3 py-2 text-right">Slips</th>
              <th className="px-3 py-2 text-right">Litres</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Avg ₱/L</th>
              <th className="px-3 py-2 text-right">Distance</th>
              <th className="px-3 py-2 text-right">Avg km/L</th>
              <th className="px-3 py-2 text-right">₱ / km</th>
              <th className="px-3 py-2 text-right">Last slip</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : !resp?.data.length ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400">
                No redeemed slips in this period.
              </td></tr>
            ) : resp.data.map((r) => (
              <tr key={r.group_key} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-xs text-slate-900 dark:text-slate-100">
                  {r.label}
                  {r.sublabel && <div className="text-[10px] text-slate-400">{r.sublabel}</div>}
                </td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{r.slip_count}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{fmt(r.total_litres)}</td>
                <td className="px-3 py-2 text-right text-xs font-medium text-slate-900 dark:text-slate-100">₱{fmt(r.total_amount)}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{fmt(r.avg_unit_price, 2)}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">
                  {r.total_km != null ? `${fmt(r.total_km, 0)} km` : '—'}
                </td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{fmt(r.avg_km_per_litre, 2)}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">
                  {r.total_km && r.total_km > 0 ? `₱${fmt(r.total_amount / r.total_km, 2)}` : '—'}
                </td>
                <td className="px-3 py-2 text-right text-xs text-slate-500 dark:text-slate-400">{fmtDate(r.last_slip_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        km/L is derived from consecutive redeemed slips on the same vehicle, so it is only accurate when every
        gas-up for that vehicle goes through a slip. Slips with no prior odometer reading are excluded from the average.
      </p>
    </div>
  );
}
