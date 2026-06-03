'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface DRRow {
  id: string; dr_no: string; delivery_date: string;
  customer_name: string; order_no: string;
  warehouse_name: string; status: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft:    'bg-slate-100 text-slate-700',
  posted:   'bg-emerald-100 text-emerald-700',
  voided:   'bg-red-100 text-red-700',
};

const STATUSES = ['all','draft','posted','voided'] as const;

const COLUMNS: ColDef<DRRow>[] = [
  { key: 'dr_no',          header: 'DR No.',     render: r => <Link href={`/dashboard/sales/delivery-receipts/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">{r.dr_no}</Link>, exportValue: r => r.dr_no },
  { key: 'delivery_date',  header: 'Date',       render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.delivery_date)}</span>, exportValue: r => formatDate(r.delivery_date) },
  { key: 'customer_name',  header: 'Customer',   render: r => <span className="font-medium text-slate-900 dark:text-slate-100">{r.customer_name}</span>, exportValue: r => r.customer_name },
  { key: 'order_no',       header: 'Sales Order', render: r => <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{r.order_no}</span>, exportValue: r => r.order_no },
  { key: 'warehouse_name', header: 'Warehouse',  render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.warehouse_name}</span>, exportValue: r => r.warehouse_name },
  { key: 'status',         header: 'Status',     render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status}</span>, exportValue: r => r.status },
];

export default function DeliveryReceiptsPage() {
  const [rows, setRows]       = useState<DRRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [status, setStatus]   = useState<string>('all');
  const [page, setPage]       = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true); setPage(1);
    const q = status === 'all'
      ? `/sales/delivery-receipts?company_id=${cid}&limit=500`
      : `/sales/delivery-receipts?company_id=${cid}&status=${status}&limit=500`;
    api.get<{ data: DRRow[] }>(q)
      .then(r => setRows(r.data ?? [])).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Delivery Receipts</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Post stock deliveries against approved sales orders.</p>
        </div>
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

      <DataTable id="dr-list" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="delivery-receipts">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
