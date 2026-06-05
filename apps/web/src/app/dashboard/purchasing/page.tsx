'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';

interface PurchasingSummary {
  open_po_count: number;
  pending_approval_count: number;
  total_open_po_value: number;
  grn_this_month: number;
}

const MODULES = [
  { href: '/dashboard/admin/master-data/suppliers', label: 'Suppliers',       desc: 'Manage vendor master records, TIN, EWT rates, and payment terms.',  color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/purchasing/purchase-orders', label: 'Purchase Orders', desc: 'Create, submit, and track POs through approval and receipt.',        color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/purchasing/goods-receipts',  label: 'Goods Receipts',  desc: 'Record goods received against approved purchase orders.',           color: 'border-brand-200 bg-brand-50 text-brand-800' },
];

export default function PurchasingHomePage() {
  const [summary, setSummary] = useState<PurchasingSummary | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<{ data: { status: string; total: number; count: number }[] }>(
        `/purchasing/purchase-orders?company_id=${companyId}&limit=500`
      ),
    ]).then(([pos]) => {
      const rows = pos.data as unknown as { status: string; total: number }[];
      const open = rows.filter((r) => ['draft','pending_approval','approved','partial'].includes(r.status));
      const pending = rows.filter((r) => r.status === 'pending_approval');
      setSummary({
        open_po_count: open.length,
        pending_approval_count: pending.length,
        total_open_po_value: open.reduce((s, r) => s + Number(r.total ?? 0), 0),
        grn_this_month: 0,
      });
    }).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Purchasing</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Suppliers, purchase orders, and goods receipts.</p>

      <div className="grid grid-cols-2 gap-4">
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href}
            className={`rounded-lg border p-5 transition-opacity hover:opacity-80 ${m.color}`}>
            <div className="font-medium">{m.label}</div>
            <p className="mt-1 text-xs leading-relaxed opacity-80">{m.desc}</p>
          </Link>
        ))}
      </div>

      {summary && (
        <div className="mt-6 grid grid-cols-3 gap-3">
          <KPI label="Open POs" value={String(summary.open_po_count)} sub="Draft · Approved · Partial" />
          <KPI label="Pending Approval" value={String(summary.pending_approval_count)} sub="Awaiting sign-off" warn={summary.pending_approval_count > 0} />
          <KPI label="Open PO Value" value={formatPHP(summary.total_open_po_value)} sub="Total committed" />
        </div>
      )}
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
