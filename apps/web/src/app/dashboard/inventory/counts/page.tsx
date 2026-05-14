'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';

interface CountRow {
  id: string;
  count_no: string;
  count_type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  posted_at: string | null;
  warehouse_name: string;
  notes: string | null;
  line_count: number;
}

const STATUS_STYLES: Record<string, string> = {
  draft:       'bg-slate-100 text-slate-700 dark:text-slate-300',
  in_progress: 'bg-amber-100 text-amber-700',
  posted:      'bg-emerald-100 text-emerald-700',
  voided:      'bg-red-100 text-red-700',
};

const STATUSES = ['all', 'in_progress', 'posted', 'voided'] as const;

export default function StockCountsPage() {
  const [rows, setRows] = useState<CountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    setPage(1);
    const q = status === 'all'
      ? `/inventory/counts?company_id=${companyId}&limit=500`
      : `/inventory/counts?company_id=${companyId}&status=${status}&limit=500`;
    api.get<{ data: CountRow[] }>(q)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stock Counts</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Full, cycle, and spot physical inventory counts.</p>
        </div>
        <Link href="/dashboard/inventory/counts/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          + Start count
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              status === s ? 'bg-brand-600 text-white'
                : 'border border-slate-300 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Count no.</th>
              <th className="px-3 py-2 text-left font-medium">Started</th>
              <th className="px-3 py-2 text-left font-medium">Warehouse</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Lines</th>
              <th className="px-3 py-2 text-left font-medium">Posted</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">No counts found. Click <em>+ Start count</em> to begin one.</td></tr>
            ) : paged.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/inventory/counts/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                    {r.count_no}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.started_at ? formatDate(r.started_at) : '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{r.warehouse_name}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.count_type}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-400">{r.line_count}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.posted_at ? formatDate(r.posted_at) : '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>
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
