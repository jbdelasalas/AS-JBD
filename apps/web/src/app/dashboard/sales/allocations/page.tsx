'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface AllocRow {
  id: string; allocation_no: string; allocation_date: string;
  delivery_date: string | null; customer_name_live: string; customer_code: string;
  status: string; so_no: string | null; tally_sheet_id: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft:  'bg-slate-100 text-slate-700',
  posted: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};
const STATUSES = ['all','draft','posted','cancelled'] as const;

const COLUMNS: ColDef<AllocRow>[] = [
  { key: 'allocation_no', header: 'Alloc. No.', render: r => <Link href={`/dashboard/sales/allocations/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">{r.allocation_no}</Link>, exportValue: r => r.allocation_no },
  { key: 'allocation_date', header: 'Date', render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.allocation_date)}</span>, exportValue: r => formatDate(r.allocation_date) },
  { key: 'delivery_date', header: 'Delivery', render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.delivery_date ? formatDate(r.delivery_date) : '—'}</span>, exportValue: r => r.delivery_date ? formatDate(r.delivery_date) : '' },
  { key: 'customer_name_live', header: 'Customer', render: r => <><div className="font-medium text-slate-900 dark:text-slate-100">{r.customer_name_live}</div><div className="text-xs text-slate-500">{r.customer_code}</div></>, exportValue: r => r.customer_name_live },
  { key: 'so_no', header: 'SO Ref.', render: r => r.so_no ? <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{r.so_no}</span> : <span className="text-slate-400">—</span>, exportValue: r => r.so_no ?? '' },
  { key: 'tally_sheet_id', header: 'Tally', render: r => r.tally_sheet_id ? <Link href={`/dashboard/sales/tally-sheets/${r.tally_sheet_id}`} className="text-xs text-blue-600 hover:underline dark:text-blue-400">View Tally</Link> : <span className="text-slate-400 text-xs">—</span>, exportValue: r => r.tally_sheet_id ? 'yes' : 'no' },
  { key: 'status', header: 'Status', render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status}</span>, exportValue: r => r.status },
];

export default function AllocationsPage() {
  const [rows, setRows]       = useState<AllocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [status, setStatus]   = useState<string>('all');
  const [page, setPage]       = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true); setPage(1);
    const q = status === 'all'
      ? `/sales/allocations?company_id=${cid}&limit=500`
      : `/sales/allocations?company_id=${cid}&status=${status}&limit=500`;
    api.get<{ data: AllocRow[] }>(q)
      .then(r => setRows(r.data)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Order Allocations</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Allocate quantities per customer order — posting auto-creates a Sales Tally Sheet.</p>
        </div>
        <Link href="/dashboard/sales/allocations/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New Allocation</Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${status === s ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {s}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <DataTable id="alloc-list" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="order-allocations">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
