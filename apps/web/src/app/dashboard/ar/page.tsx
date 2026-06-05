'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';
import type { ARSummary } from '@perpet/shared';

const MODULES = [
  { href: '/dashboard/ar/invoices',    label: 'Sales Invoices',   desc: 'Issue, post, and track customer invoices.',    color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/ar/collections', label: 'Collections',      desc: 'Record payments and issue official receipts.',  color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/ar/credit-memos',label: 'Credit Memos',     desc: 'Issue and apply AR credit adjustments.',        color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/admin/master-data/customers', label: 'Customers', desc: 'Manage customer accounts and credit limits.', color: 'border-brand-200 bg-brand-50 text-brand-800' },
];

export default function ARPage() {
  const [summary, setSummary] = useState<ARSummary | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    api.get<ARSummary>(`/ar/reports/summary?company_id=${companyId}`)
      .then(setSummary)
      .catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Accounts Receivable</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Customers, invoices, collections and aging.</p>

      <div className="grid grid-cols-2 gap-4">
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href}
            className={`rounded-lg border p-5 hover:opacity-80 transition-opacity ${m.color}`}
          >
            <div className="font-medium">{m.label}</div>
            <p className="mt-1 text-xs leading-relaxed opacity-80">{m.desc}</p>
          </Link>
        ))}
      </div>

      {summary && (
        <div className="mt-6 grid grid-cols-4 gap-3">
          <KPI label="Open AR" value={formatPHP(summary.total_open_ar)} sub={`${summary.invoice_count_open} invoices`} />
          <KPI label="Overdue" value={formatPHP(summary.total_overdue)} sub="Past due date" danger />
          <KPI label="Collected MTD" value={formatPHP(summary.total_collected_mtd)} sub="This month" good />
          <KPI label="Active Customers" value={String(summary.customer_count_active)} sub="With open AR" />
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, sub, danger, good }: {
  label: string; value: string; sub: string; danger?: boolean; good?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold ${danger ? 'text-red-600' : good ? 'text-emerald-600' : 'text-slate-900 dark:text-slate-100'}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{sub}</div>
    </div>
  );
}
