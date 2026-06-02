'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

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

const COLUMNS: ColDef<CountRow>[] = [
  { key: 'count_no',       header: 'Count No.',  render: r => <Link href={`/dashboard/inventory/counts/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">{r.count_no}</Link>, exportValue: r => r.count_no },
  { key: 'started_at',    header: 'Started',     render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.started_at ? formatDate(r.started_at) : '—'}</span>, exportValue: r => r.started_at ? formatDate(r.started_at) : '' },
  { key: 'warehouse_name',header: 'Warehouse',   render: r => <span className="text-xs text-slate-700 dark:text-slate-300">{r.warehouse_name}</span>, exportValue: r => r.warehouse_name },
  { key: 'count_type',    header: 'Type',        render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.count_type}</span>, exportValue: r => r.count_type },
  { key: 'line_count',    header: 'Lines',       align: 'right', render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.line_count}</span>, exportValue: r => String(r.line_count) },
  { key: 'posted_at',     header: 'Posted',      render: r => <span className="text-xs text-slate-500 dark:text-slate-400">{r.posted_at ? formatDate(r.posted_at) : '—'}</span>, exportValue: r => r.posted_at ? formatDate(r.posted_at) : '' },
  { key: 'status',        header: 'Status',      render: r => <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status.replace(/_/g, ' ')}</span>, exportValue: r => r.status },
];

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

      <DataTable id="inventory-counts" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="stock-counts"
        emptyMessage="No counts found. Click + Start count to begin one.">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
