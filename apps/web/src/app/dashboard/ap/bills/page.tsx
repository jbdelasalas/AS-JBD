'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';

interface BillRow {
  id: string;
  internal_no: string;
  bill_no: string;
  bill_date: string;
  due_date: string;
  supplier_name: string;
  supplier_code: string;
  total: number;
  balance: number;
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  partial: 'bg-orange-100 text-orange-700',
  paid: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

const STATUSES = ['all','draft','pending_approval','approved','partial','paid','voided'] as const;

export default function BillsPage() {
  const [rows, setRows] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    setPage(1);
    const q = status === 'all'
      ? `/ap/bills?company_id=${companyId}&limit=500`
      : `/ap/bills?company_id=${companyId}&status=${status}&limit=500`;
    api.get<{ data: BillRow[] }>(q)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Bills</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Vendor invoices and AP balances.</p>
        </div>
        <Link href="/dashboard/ap/bills/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          + New bill
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              status === s ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Internal no.</th>
              <th className="px-3 py-2 text-left font-medium">Supplier Bill no.</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Due date</th>
              <th className="px-3 py-2 text-left font-medium">Supplier</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-slate-500">No bills found.</td></tr>
            ) : paged.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/ap/bills/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">
                    {r.internal_no}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{r.bill_no}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(r.bill_date)}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(r.due_date)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900 dark:text-slate-100">{r.supplier_name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{r.supplier_code}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs dark:text-slate-300">{formatPHP(r.total)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                  <span className={r.balance > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                    {formatPHP(r.balance)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>
                    {r.status.replace(/_/g, ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </div>
  );
}
