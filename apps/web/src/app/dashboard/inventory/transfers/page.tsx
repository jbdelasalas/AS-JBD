'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

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

const COLUMNS: ColDef<TransferRow>[] = [
  { key: 'transfer_no',         header: 'Transfer No.',  render: r => <Link href={`/dashboard/inventory/transfers/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">{r.transfer_no}</Link>, exportValue: r => r.transfer_no },
  { key: 'created_at',          header: 'Created',       render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.created_at)}</span>, exportValue: r => formatDate(r.created_at) },
  { key: 'from_warehouse_name', header: 'From',          render: r => <span className="text-xs text-slate-700 dark:text-slate-300">{r.from_warehouse_name}</span>, exportValue: r => r.from_warehouse_name },
  { key: 'to_warehouse_name',   header: 'To',            render: r => <span className="text-xs text-slate-700 dark:text-slate-300">{r.to_warehouse_name}</span>, exportValue: r => r.to_warehouse_name },
  { key: 'sent_at',             header: 'Sent',          render: r => <span className="text-xs text-slate-500 dark:text-slate-400">{r.sent_at ? formatDate(r.sent_at) : '—'}</span>, exportValue: r => r.sent_at ? formatDate(r.sent_at) : '' },
  { key: 'received_at',         header: 'Received',      render: r => <span className="text-xs text-slate-500 dark:text-slate-400">{r.received_at ? formatDate(r.received_at) : '—'}</span>, exportValue: r => r.received_at ? formatDate(r.received_at) : '' },
  { key: 'status',              header: 'Status',        render: r => <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status.replace(/_/g, ' ')}</span>, exportValue: r => r.status },
];

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

      <DataTable id="inventory-transfers" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="transfers"
        emptyMessage="No transfers found. Click + New transfer to create one.">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
