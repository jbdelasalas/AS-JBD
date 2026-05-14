'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';

interface TransferRow {
  id: string;
  transfer_no: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
  from_warehouse_name: string;
  to_warehouse_name: string;
  notes: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft:       'bg-slate-100 text-slate-700 dark:text-slate-300',
  in_transit:  'bg-amber-100 text-amber-700',
  received:    'bg-emerald-100 text-emerald-700',
  cancelled:   'bg-red-100 text-red-700',
};

const STATUSES = ['all', 'draft', 'in_transit', 'received', 'cancelled'] as const;

export default function TransfersPage() {
  const [rows, setRows] = useState<TransferRow[]>([]);
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
      ? `/inventory/transfers?company_id=${companyId}&limit=500`
      : `/inventory/transfers?company_id=${companyId}&status=${status}&limit=500`;
    api.get<{ data: TransferRow[] }>(q)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stock Transfers</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Move stock between warehouses.</p>
        </div>
        <Link href="/dashboard/inventory/transfers/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          + New transfer
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
              <th className="px-3 py-2 text-left font-medium">Transfer no.</th>
              <th className="px-3 py-2 text-left font-medium">Created</th>
              <th className="px-3 py-2 text-left font-medium">From</th>
              <th className="px-3 py-2 text-left font-medium">To</th>
              <th className="px-3 py-2 text-left font-medium">Sent</th>
              <th className="px-3 py-2 text-left font-medium">Received</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">No transfers found. Click <em>+ New transfer</em> to create one.</td></tr>
            ) : paged.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/inventory/transfers/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                    {r.transfer_no}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(r.created_at)}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{r.from_warehouse_name}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{r.to_warehouse_name}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.sent_at ? formatDate(r.sent_at) : '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.received_at ? formatDate(r.received_at) : '—'}</td>
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
