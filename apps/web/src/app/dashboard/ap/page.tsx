'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';

interface APSummary {
  total_open_ap: number;
  total_overdue: number;
  bill_count_open: number;
  draft_payments: number;
}

const MODULES = [
  { href: '/dashboard/admin/master-data/suppliers', label: 'Suppliers',  desc: 'Manage vendor master records, TIN, payment terms, and EWT rates.',   color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/ap/bills',             label: 'Bills',      desc: 'Enter vendor invoices, match to POs, and track AP balances.',         color: 'border-amber-200 bg-amber-50 text-amber-800' },
  { href: '/dashboard/ap/payments',          label: 'Payments',   desc: 'Record supplier payments, generate vouchers, and post to GL.',        color: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
];

export default function ApHomePage() {
  const [summary, setSummary] = useState<APSummary | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<{ data: { status: string; balance: number; due_date: string }[] }>(
        `/ap/bills?company_id=${companyId}&limit=500`
      ),
      api.get<{ data: { status: string }[] }>(
        `/ap/payments?company_id=${companyId}&limit=500`
      ),
    ]).then(([bills, payments]) => {
      const today = new Date().toISOString().split('T')[0];
      const open = (bills.data as unknown as { status: string; balance: number; due_date: string }[])
        .filter((b) => ['approved', 'partial'].includes(b.status));
      const overdue = open.filter((b) => b.due_date < today);
      const drafts = (payments.data as unknown as { status: string }[])
        .filter((p) => p.status === 'draft');
      setSummary({
        total_open_ap: open.reduce((s, b) => s + Number(b.balance ?? 0), 0),
        total_overdue: overdue.reduce((s, b) => s + Number(b.balance ?? 0), 0),
        bill_count_open: open.length,
        draft_payments: drafts.length,
      });
    }).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Accounts Payable</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Suppliers, vendor bills, payment vouchers and EWT certificates.</p>

      {summary && (
        <div className="mb-6 grid grid-cols-4 gap-3">
          <KPI label="Open AP" value={formatPHP(summary.total_open_ap)} sub={`${summary.bill_count_open} bills`} />
          <KPI label="Overdue" value={formatPHP(summary.total_overdue)} sub="Past due date" danger={summary.total_overdue > 0} />
          <KPI label="Draft Payments" value={String(summary.draft_payments)} sub="Pending posting" warn={summary.draft_payments > 0} />
          <KPI label="Suppliers" value="—" sub="Active vendors" />
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

function KPI({ label, value, sub, danger, warn }: {
  label: string; value: string; sub: string; danger?: boolean; warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold ${danger ? 'text-red-600' : warn ? 'text-amber-600' : 'text-slate-900 dark:text-slate-100'}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{sub}</div>
    </div>
  );
}
