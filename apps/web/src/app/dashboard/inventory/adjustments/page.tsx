'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';

interface AdjRow {
  id: string;
  adj_no: string;
  reason_code: string;
  status: string;
  created_at: string;
  posted_at: string | null;
  warehouse_name: string;
  created_by_name: string;
  notes: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft:  'bg-slate-100 text-slate-700 dark:text-slate-300',
  posted: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

const STATUSES = ['all', 'draft', 'posted', 'voided'] as const;

export default function AdjustmentsPage() {
  const [rows, setRows] = useState<AdjRow[]>([]);
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
      ? `/inventory/adjustments?company_id=${companyId}&limit=500`
      : `/inventory/adjustments?company_id=${companyId}&status=${status}&limit=500`;
    api.get<{ data: AdjRow[] }>(q)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stock Adjustments</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Post inventory gains, losses, and corrections.</p>
        </div>
        <Link href="/dashboard/inventory/adjustments/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          + New adjustment
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              status === s ? 'bg-brand-600 text-white'
                : 'border border-slate-300 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}>
            {s}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Adj no.</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Warehouse</th>
              <th className="px-3 py-2 text-left font-medium">Reason</th>
              <th className="px-3 py-2 text-left font-medium">Notes</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">No adjustments found. Click <em>+ New adjustment</em> to create one.</td></tr>
            ) : paged.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/inventory/adjustments/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                    {r.adj_no}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(r.created_at)}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.warehouse_name}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{r.reason_code.replace(/_/g, ' ')}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 max-w-xs truncate">{r.notes ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>
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
