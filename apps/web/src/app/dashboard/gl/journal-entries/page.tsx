'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { PaginatedResponse } from '@perpet/shared';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface JeListRow {
  id: string;
  entry_no: string;
  entry_date: string;
  reference: string | null;
  memo: string | null;
  status: 'draft' | 'pending' | 'posted' | 'voided';
  posted_at: string | null;
  total_debit: number;
}

const STATUS_STYLES: Record<string, string> = {
  draft:   'bg-slate-100 text-slate-700 dark:text-slate-300',
  pending: 'bg-amber-100 text-amber-700',
  posted:  'bg-emerald-100 text-emerald-700',
  voided:  'bg-red-100 text-red-700',
};

const COLUMNS: ColDef<JeListRow>[] = [
  { key: 'entry_no',   header: 'Entry No.',  render: r => <Link href={`/dashboard/gl/journal-entries/${r.id}`} className="text-brand-700 hover:underline dark:text-brand-400">{r.entry_no}</Link>, exportValue: r => r.entry_no },
  { key: 'entry_date', header: 'Date',       render: r => <span className="text-slate-700 dark:text-slate-300">{formatDate(r.entry_date)}</span>, exportValue: r => formatDate(r.entry_date) },
  { key: 'reference',  header: 'Reference',  render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.reference ?? '—'}</span>, exportValue: r => r.reference ?? '' },
  { key: 'memo',       header: 'Memo',       render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.memo ?? '—'}</span>, exportValue: r => r.memo ?? '' },
  { key: 'total_debit',header: 'Amount',     align: 'right', render: r => <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{formatPHP(r.total_debit)}</span>, exportValue: r => String(r.total_debit) },
  { key: 'status',     header: 'Status',     render: r => <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status}</span>, exportValue: r => r.status },
];

export default function JournalEntriesPage() {
  const [data, setData] = useState<JeListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'posted' | 'voided'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    setPage(1);
    const url =
      statusFilter === 'all'
        ? `/gl/journal-entries?company_id=${companyId}&limit=500`
        : `/gl/journal-entries?company_id=${companyId}&status=${statusFilter}&limit=500`;
    api
      .get<PaginatedResponse<JeListRow>>(url)
      .then((res) => setData(res.data))
      .catch((e) => setError(e.message ?? 'Failed to load entries'))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const paged = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Journal entries</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">All manual and system-generated entries</p>
        </div>
        <Link
          href="/dashboard/gl/journal-entries/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + New entry
        </Link>
      </div>

      <div className="mb-3 flex gap-2">
        {(['all', 'draft', 'posted', 'voided'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded px-3 py-1 text-xs ${
              statusFilter === s
                ? 'bg-brand-600 text-white'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <DataTable id="gl-journal-entries" columns={COLUMNS} rows={paged} exportRows={data} loading={loading} filename="journal-entries"
        emptyMessage="No journal entries yet. Click + New entry to create one.">
        <Pagination page={page} total={data.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
