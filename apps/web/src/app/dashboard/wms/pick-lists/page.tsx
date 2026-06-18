'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import DataTable, { ColDef } from '@/components/DataTable';

interface Row { id: string; pick_no: string; status: string; created_at: string; warehouse_name: string; order_no: string | null; }

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:text-slate-300', picking: 'bg-amber-100 text-amber-700',
  picked: 'bg-sky-100 text-sky-700', packed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700',
};
const STATUSES = ['all', 'draft', 'picked', 'packed', 'cancelled'];

const COLUMNS: ColDef<Row>[] = [
  { key: 'pick_no',        header: 'Pick No.',  render: r => <Link href={`/dashboard/wms/pick-lists/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">{r.pick_no}</Link>, exportValue: r => r.pick_no },
  { key: 'created_at',     header: 'Created',   render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.created_at)}</span>, exportValue: r => formatDate(r.created_at) },
  { key: 'warehouse_name', header: 'Warehouse', render: r => <span className="text-xs text-slate-700 dark:text-slate-300">{r.warehouse_name}</span>, exportValue: r => r.warehouse_name },
  { key: 'order_no',       header: 'Sales Order', render: r => <span className="text-xs text-slate-500 dark:text-slate-400">{r.order_no ?? '—'}</span>, exportValue: r => r.order_no ?? '' },
  { key: 'status',         header: 'Status',    render: r => <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status}</span>, exportValue: r => r.status },
];

export default function PickListsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: Row[] }>(`/wms/pick-lists?company_id=${companyId}&status=${status}`)
      .then((r) => setRows(r.data)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [status]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Pick Lists</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Pick and pack stock for outbound orders.</p>
        </div>
        <Link href="/dashboard/wms/pick-lists/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New pick list</Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${status === s ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}>{s}</button>
        ))}
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <DataTable id="wms-pick-lists" columns={COLUMNS} rows={rows} exportRows={rows} loading={loading} filename="pick-lists" emptyMessage="No pick lists yet." />
    </div>
  );
}
