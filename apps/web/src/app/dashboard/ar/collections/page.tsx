'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';

interface PaymentRow {
  id: string;
  receipt_no: string;
  payment_date: string;
  customer_name: string;
  customer_code: string;
  payment_method: string;
  amount: number;
  unapplied_amount: number;
  is_advance: boolean;
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  posted: 'bg-blue-100 text-blue-700',
  cleared: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', check: 'Check', bank_transfer: 'Bank Transfer',
  credit_card: 'Credit Card', online: 'Online',
};

const STATUSES = ['all', 'draft', 'posted', 'cleared', 'cancelled'] as const;

export default function CollectionsPage() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
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
      ? `/ar/collections?company_id=${companyId}&limit=500`
      : `/ar/collections?company_id=${companyId}&status=${status}&limit=500`;
    api.get<{ data: PaymentRow[] }>(q)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Collections</h1>
          <p className="text-sm text-slate-600">Customer payments and official receipts.</p>
        </div>
        <Link href="/dashboard/ar/collections/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          + New collection
        </Link>
      </div>

      <div className="mb-3 flex gap-1.5">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              status === s ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}>
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">OR no.</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Customer</th>
              <th className="px-3 py-2 text-left font-medium">Method</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Unapplied</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500">No collections found.</td></tr>
            ) : paged.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/ar/collections/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                    {r.receipt_no}
                  </Link>
                  {r.is_advance && (
                    <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">ADV</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">{formatDate(r.payment_date)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{r.customer_name}</div>
                  <div className="text-xs text-slate-500">{r.customer_code}</div>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">{METHOD_LABELS[r.payment_method] ?? r.payment_method}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{formatPHP(r.amount)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {r.unapplied_amount > 0
                    ? <span className="text-amber-700">{formatPHP(r.unapplied_amount)}</span>
                    : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>
                    {r.status}
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
