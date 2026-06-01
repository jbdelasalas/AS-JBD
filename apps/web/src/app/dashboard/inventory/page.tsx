'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';

interface InvSummary {
  item_count: number;
  low_stock_count: number;
  total_stock_value: number;
  draft_adj_count: number;
  in_transit_count: number;
  open_count_count: number;
}

const MODULES = [
  { href: '/dashboard/admin/master-data/items', label: 'Items',             desc: 'Manage SKUs, categories, costing method, and reorder levels.',       color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/admin/master-data/locations', label: 'Locations',    desc: 'Set up warehouses and storage locations for inventory tracking.',    color: 'border-teal-200 bg-teal-50 text-teal-800' },
  { href: '/dashboard/inventory/stock-on-hand', label: 'Stock On Hand',    desc: 'View current balances and stock values by item and location.',       color: 'border-slate-200 bg-slate-50 text-slate-800' },
  { href: '/dashboard/inventory/adjustments',  label: 'Adjustments',       desc: 'Post stock gains and losses — damage, spoilage, count corrections.', color: 'border-amber-200 bg-amber-50 text-amber-800' },
  { href: '/dashboard/inventory/transfers',    label: 'Transfers',         desc: 'Move stock between locations with full in-transit tracking.',        color: 'border-violet-200 bg-violet-50 text-violet-800' },
  { href: '/dashboard/inventory/counts',       label: 'Stock Counts',      desc: 'Run full, cycle, or spot counts and post count corrections.',        color: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
];

export default function InventoryHomePage() {
  const [summary, setSummary] = useState<InvSummary | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<unknown[]>(`/inventory/items?company_id=${companyId}&limit=500`),
      api.get<unknown[]>(`/inventory/stock-on-hand?company_id=${companyId}`),
      api.get<{ data: unknown[] }>(`/inventory/adjustments?company_id=${companyId}&limit=500`),
      api.get<{ data: unknown[] }>(`/inventory/transfers?company_id=${companyId}&limit=500`),
      api.get<{ data: unknown[] }>(`/inventory/counts?company_id=${companyId}&limit=500`),
    ]).then(([items, soh, adjs, xfrs, cnts]) => {
      const sohRows = soh as Array<Record<string, number>>;
      const adjRows = (adjs as { data: Array<Record<string, unknown>> }).data;
      const xfrRows = (xfrs as { data: Array<Record<string, unknown>> }).data;
      const cntRows = (cnts as { data: Array<Record<string, unknown>> }).data;
      setSummary({
        item_count: (items as unknown[]).length,
        low_stock_count: sohRows.filter((r) => r.qty_on_hand <= r.reorder_point && r.reorder_point > 0).length,
        total_stock_value: sohRows.reduce((s, r) => s + Number(r.stock_value ?? 0), 0),
        draft_adj_count: adjRows.filter((r) => r.status === 'draft').length,
        in_transit_count: xfrRows.filter((r) => r.status === 'in_transit').length,
        open_count_count: cntRows.filter((r) => r.status === 'in_progress').length,
      });
    }).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Inventory</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Items, locations, stock movements, adjustments, transfers, and counts.</p>

      {summary && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <KPI label="Total Items" value={String(summary.item_count)} sub="Active SKUs" />
          <KPI label="Low Stock" value={String(summary.low_stock_count)} sub="Below reorder point" warn={summary.low_stock_count > 0} />
          <KPI label="Stock Value" value={formatPHP(summary.total_stock_value)} sub="Avg cost basis" />
          <KPI label="Draft Adjustments" value={String(summary.draft_adj_count)} sub="Awaiting posting" warn={summary.draft_adj_count > 0} />
          <KPI label="In Transit" value={String(summary.in_transit_count)} sub="Transfers not received" warn={summary.in_transit_count > 0} />
          <KPI label="Open Counts" value={String(summary.open_count_count)} sub="Counts in progress" warn={summary.open_count_count > 0} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href}
            className={`rounded-lg border p-5 transition-opacity hover:opacity-80 ${m.color}`}>
            <div className="font-medium">{m.label}</div>
            <p className="mt-1 text-xs leading-relaxed opacity-80">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function KPI({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold ${warn ? 'text-amber-600' : 'text-slate-900 dark:text-slate-100'}`}>{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{sub}</div>
    </div>
  );
}
