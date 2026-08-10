'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Slip {
  id: string;
  slip_no: string;
  entity_code: string;
  issue_date: string;
  issued_to_name: string;
  position_dept: string | null;
  plate_no: string | null;
  product: string;
  quantity_litres: number | null;
  actual_litres: number | null;
  amount: number | null;
  unit_price: number | null;
  km_travelled: number | null;
  km_per_litre: number | null;
  official_receipt_no: string | null;
  status: string;
  employee_name: string | null;
  vehicle_description: string | null;
}

interface ListResponse {
  data: Slip[];
  total: number;
  summary: { total_litres: number; total_amount: number } | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  issued:    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  redeemed:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

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

export default function FuelPOSlipsPage() {
  const [slips, setSlips] = useState<Slip[]>([]);
  const [summary, setSummary] = useState<{ total_litres: number; total_amount: number } | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ company_id: companyId, limit: '100' });
    if (status) qs.set('status', status);
    if (search) qs.set('search', search);
    if (dateFrom) qs.set('date_from', dateFrom);
    if (dateTo) qs.set('date_to', dateTo);

    api.get<ListResponse>(`/fuel/po-slips?${qs}`)
      .then((r) => { setSlips(r.data); setTotal(r.total); setSummary(r.summary); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [companyId, status, search, dateFrom, dateTo]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Gas P.O. Slips</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Employee gas consumption. Issue a slip, print it for the driver, then capture what the station accomplished.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/fuel/consumption"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Consumption Report
          </Link>
          <Link
            href="/dashboard/fuel/po-slips/new"
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New Slip
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {/* Filters */}
      <div className="mb-4 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-12 sm:col-span-4">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Slip no., name, plate, OR no."
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="redeemed">Redeemed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="col-span-6 sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">From</label>
          <input
            type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div className="col-span-6 sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">To</label>
          <input
            type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div className="col-span-6 sm:col-span-1 flex items-end">
          <button
            onClick={() => { setStatus(''); setSearch(''); setDateFrom(''); setDateTo(''); }}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Summary — redeemed slips only, so these are actual spend not authorisations */}
      {summary && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Slips</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{total}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Litres dispensed</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{fmt(summary.total_litres)} L</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Amount</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">₱{fmt(summary.total_amount)}</div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Slip No.</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Issued to</th>
              <th className="px-3 py-2 text-left">Vehicle</th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-right">Auth. L</th>
              <th className="px-3 py-2 text-right">Actual L</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">km/L</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Print</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : slips.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-xs text-slate-400">
                No slips found. Create one to get started.
              </td></tr>
            ) : slips.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/fuel/po-slips/${s.id}`} className="font-mono text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                    {s.slip_no}
                  </Link>
                  <div className="text-[10px] text-slate-400">{s.entity_code}</div>
                </td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{fmtDate(s.issue_date)}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
                  {s.issued_to_name}
                  {s.position_dept && <div className="text-[10px] text-slate-400">{s.position_dept}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-mono">{s.plate_no ?? '—'}</span>
                  {s.vehicle_description && <div className="text-[10px] text-slate-400">{s.vehicle_description}</div>}
                </td>
                <td className="px-3 py-2 text-xs capitalize text-slate-700 dark:text-slate-300">{s.product}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-500 dark:text-slate-400">{fmt(s.quantity_litres, 0)}</td>
                <td className="px-3 py-2 text-right text-xs font-medium text-slate-900 dark:text-slate-100">{fmt(s.actual_litres)}</td>
                <td className="px-3 py-2 text-right text-xs font-medium text-slate-900 dark:text-slate-100">
                  {s.amount == null ? '—' : `₱${fmt(s.amount)}`}
                </td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{fmt(s.km_per_litre, 2)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[s.status] ?? STATUS_STYLES.draft}`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <a
                    href={`/print/fuel-po-slip/${s.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand-600 hover:underline dark:text-brand-400"
                  >
                    Print
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
