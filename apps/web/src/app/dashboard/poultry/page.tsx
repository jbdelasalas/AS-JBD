'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface DashData {
  active_batches: number;
  total_birds: number;
  mortality_this_week: number;
  pending_deliveries: number;
  unpaid_invoices_count: number;
  unpaid_invoices_amount: number;
  recent_deliveries: Array<{ doc_no: string; transaction_date: string; status: string; total_amount: number; customer_name: string }>;
  active_cycles: Array<{ doc_no: string; start_date: string; heads_in: number; heads_available: number; total_mortality: number; status: string; building_name: string | null; item_name: string }>;
}

const STATUS_COLORS: Record<string, string> = {
  saved: 'bg-slate-100 text-slate-700',
  confirmed: 'bg-blue-100 text-blue-700',
  posted: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
  active: 'bg-emerald-100 text-emerald-700',
  harvesting: 'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
};

export default function PoultryDashboard() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    api.get<DashData>(`/poultry/dashboard?company_id=${companyId}`)
      .then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Poultry Operations</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Farm monitor, inventory, and sales overview.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Active Batches', value: data?.active_batches ?? 0, href: '/dashboard/poultry/grow-cycles' },
          { label: 'Live Birds', value: (data?.total_birds ?? 0).toLocaleString(), href: '/dashboard/poultry/grow-cycles' },
          { label: 'Mortality (7d)', value: (data?.mortality_this_week ?? 0).toLocaleString(), href: '/dashboard/poultry/grow-cycles' },
          { label: 'Pending Deliveries', value: data?.pending_deliveries ?? 0, href: '/dashboard/poultry/deliveries' },
          { label: 'Unpaid AR', value: formatPHP(data?.unpaid_invoices_amount ?? 0), href: '/dashboard/poultry/invoices' },
        ].map((card) => (
          <Link key={card.label} href={card.href}
            className="rounded-lg border border-slate-200 bg-white p-4 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">{card.label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{card.value}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Active grow cycles */}
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Active Grow Cycles</span>
            <Link href="/dashboard/poultry/grow-cycles" className="text-xs text-brand-600 hover:underline">View all</Link>
          </div>
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Cycle</th>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Building</th>
                <th className="px-3 py-2 text-right">Heads</th>
                <th className="px-3 py-2 text-right">Mortality</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {!data?.active_cycles?.length ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No active cycles</td></tr>
              ) : data.active_cycles.map((c) => (
                <tr key={c.doc_no} className="border-t border-slate-50 dark:border-slate-700">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/poultry/grow-cycles`} className="text-brand-600 hover:underline font-mono">{c.doc_no}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{c.item_name}</td>
                  <td className="px-3 py-2 text-slate-500">{c.building_name ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(c.heads_available).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-600">{Number(c.total_mortality).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[c.status] ?? 'bg-slate-100 text-slate-600'}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recent deliveries */}
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Recent Deliveries</span>
            <Link href="/dashboard/poultry/deliveries" className="text-xs text-brand-600 hover:underline">View all</Link>
          </div>
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Doc No.</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {!data?.recent_deliveries?.length ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No deliveries yet</td></tr>
              ) : data.recent_deliveries.map((d) => (
                <tr key={d.doc_no} className="border-t border-slate-50 dark:border-slate-700">
                  <td className="px-3 py-2 font-mono text-brand-600">{d.doc_no}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{d.customer_name}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDate(d.transaction_date)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatPHP(d.total_amount)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[d.status] ?? 'bg-slate-100 text-slate-600'}`}>{d.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
