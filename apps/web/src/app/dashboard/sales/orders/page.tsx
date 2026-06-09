'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface SORow {
  id: string;
  order_no: string;
  order_date: string;
  delivery_date: string | null;
  customer_name: string;
  customer_code: string;
  total: number;
  status: string;
  total_qty_ordered: number;
  total_qty_delivered: number;
}

const STATUS_STYLES: Record<string, string> = {
  draft:               'bg-slate-100 text-slate-700',
  pending_approval:    'bg-amber-100 text-amber-700',
  approved:            'bg-blue-100 text-blue-700',
  partially_delivered: 'bg-orange-100 text-orange-700',
  fully_delivered:     'bg-emerald-100 text-emerald-700',
  closed:              'bg-purple-100 text-purple-700',
  cancelled:           'bg-red-100 text-red-700',
};

const STATUSES = ['all','draft','pending_approval','approved','partially_delivered','fully_delivered','closed','cancelled'] as const;

const COLUMNS: ColDef<SORow>[] = [
  { key: 'order_no',       header: 'Order No.',   render: r => <Link href={`/dashboard/sales/orders/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">{r.order_no}</Link>, exportValue: r => r.order_no },
  { key: 'order_date',     header: 'Date',        render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.order_date)}</span>, exportValue: r => formatDate(r.order_date) },
  { key: 'delivery_date',  header: 'Delivery',    render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.delivery_date ? formatDate(r.delivery_date) : '—'}</span>, exportValue: r => r.delivery_date ? formatDate(r.delivery_date) : '' },
  { key: 'customer_name',  header: 'Customer',    render: r => <><div className="font-medium text-slate-900 dark:text-slate-100">{r.customer_name}</div><div className="text-xs text-slate-500">{r.customer_code}</div></>, exportValue: r => r.customer_name },
  { key: 'total',          header: 'Total',       align: 'right', render: r => <span className="font-mono text-xs dark:text-slate-300">{formatPHP(r.total)}</span>, exportValue: r => String(r.total) },
  { key: 'total_qty_delivered', header: 'Heads', align: 'right', render: r => {
      const ordered = r.total_qty_ordered ?? 0;
      const delivered = r.total_qty_delivered ?? 0;
      const pct = ordered > 0 ? Math.round((delivered / ordered) * 100) : 0;
      const color = pct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : pct > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400';
      return (
        <div className="text-right">
          <span className="font-mono text-xs dark:text-slate-300">{delivered.toLocaleString()} / {ordered.toLocaleString()}</span>
          <div className={`text-[11px] font-medium ${color}`}>{pct}%</div>
        </div>
      );
    }, exportValue: r => `${r.total_qty_delivered}/${r.total_qty_ordered}` },
  { key: 'status',         header: 'Status',      render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status.replace(/_/g,' ')}</span>, exportValue: r => r.status },
];

export default function SalesOrdersPage() {
  const [rows, setRows]       = useState<SORow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [status, setStatus]   = useState<string>('all');
  const [page, setPage]       = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true); setPage(1);
    const q = status === 'all'
      ? `/sales/orders?company_id=${cid}&limit=500`
      : `/sales/orders?company_id=${cid}&status=${status}&limit=500`;
    api.get<{ data: SORow[] }>(q)
      .then(r => setRows(r.data)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Sales Orders</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Track customer orders from approval to delivery.</p>
        </div>
        <Link href="/dashboard/sales/orders/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New Order</Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${status === s ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {s.replace(/_/g,' ')}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <DataTable id="so-list" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="sales-orders">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
