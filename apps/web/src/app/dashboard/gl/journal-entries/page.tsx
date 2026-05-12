'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { PaginatedResponse } from '@perpet/shared';
import { Pagination } from '@/components/Pagination';

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
          <h1 className="text-lg font-semibold text-slate-900">Journal entries</h1>
          <p className="text-sm text-slate-600">All manual and system-generated entries</p>
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
                : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
            }`}
          >
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
              <th className="px-3 py-2 text-left font-medium">Entry no.</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Reference</th>
              <th className="px-3 py-2 text-left font-medium">Memo</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-500">Loading...</td></tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-500">
                  No journal entries yet. Click <em>+ New entry</em> to create one.
                </td>
              </tr>
            ) : (
              paged.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/gl/journal-entries/${e.id}`} className="text-brand-700 hover:underline">
                      {e.entry_no}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{formatDate(e.entry_date)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{e.reference ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{e.memo ?? '—'}</td>
                  <td className="px-3 py-2 num text-slate-900">{formatPHP(e.total_debit)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={e.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination page={page} total={data.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:   'bg-slate-100 text-slate-700',
    pending: 'bg-amber-100 text-amber-700',
    posted:  'bg-emerald-100 text-emerald-700',
    voided:  'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${styles[status] ?? styles.draft}`}>
      {status}
    </span>
  );
}
