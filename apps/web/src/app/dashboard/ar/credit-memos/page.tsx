'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';

interface CMRow {
  id: string;
  cm_no: string;
  cm_date: string;
  customer_name: string;
  original_invoice_no: string | null;
  total: number;
  amount_applied: number;
  unapplied_amount: number;
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft:            'bg-slate-100 text-slate-700 dark:text-slate-300',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved:         'bg-blue-100 text-blue-700',
  applied:          'bg-emerald-100 text-emerald-700',
  cancelled:        'bg-red-100 text-red-700',
};

const STATUSES = ['all','draft','pending_approval','approved','applied','cancelled'] as const;

export default function CreditMemosPage() {
  const [rows, setRows] = useState<CMRow[]>([]);
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
      ? `/ar/credit-memos?company_id=${companyId}&limit=500`
      : `/ar/credit-memos?company_id=${companyId}&status=${status}&limit=500`;
    api.get<{ data: CMRow[] }>(q)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">AR Credit Memos</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Issue and apply customer credit adjustments.</p>
        </div>
        <Link href="/dashboard/ar/credit-memos/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          + New credit memo
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              status === s ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:bg-slate-800'
            }`}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">CM no.</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Customer</th>
              <th className="px-3 py-2 text-left font-medium">Orig. Invoice</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">Unapplied</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">No credit memos found.</td></tr>
            ) : paged.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:bg-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/ar/credit-memos/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                    {r.cm_no}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(r.cm_date)}</td>
                <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{r.customer_name}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{r.original_invoice_no ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(r.total)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {r.unapplied_amount > 0
                    ? <span className="text-amber-700 font-semibold">{formatPHP(r.unapplied_amount)}</span>
                    : <span className="text-slate-400">—</span>}
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
