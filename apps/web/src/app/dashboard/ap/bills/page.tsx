'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface BillRow {
  id: string; internal_no: string; bill_no: string; bill_date: string; due_date: string;
  supplier_name: string; supplier_code: string; total: number; balance: number; status: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft:'bg-slate-100 text-slate-700', pending_approval:'bg-amber-100 text-amber-700',
  approved:'bg-blue-100 text-blue-700', partial:'bg-orange-100 text-orange-700',
  paid:'bg-emerald-100 text-emerald-700', voided:'bg-red-100 text-red-700',
};
const STATUSES = ['all','draft','pending_approval','approved','partial','paid','voided'] as const;

const COLUMNS: ColDef<BillRow>[] = [
  { key: 'internal_no',   header: 'Internal No.',  render: r => <Link href={`/dashboard/ap/bills/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">{r.internal_no}</Link>, exportValue: r => r.internal_no },
  { key: 'bill_no',       header: 'Supplier Bill', render: r => <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{r.bill_no}</span>, exportValue: r => r.bill_no },
  { key: 'bill_date',     header: 'Date',          render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.bill_date)}</span>, exportValue: r => formatDate(r.bill_date) },
  { key: 'due_date',      header: 'Due Date',      render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.due_date)}</span>, exportValue: r => formatDate(r.due_date) },
  { key: 'supplier_name', header: 'Supplier',      render: r => <><div className="font-medium text-slate-900 dark:text-slate-100">{r.supplier_name}</div><div className="text-xs text-slate-500">{r.supplier_code}</div></>, exportValue: r => r.supplier_name },
  { key: 'total',         header: 'Total',         align: 'right', render: r => <span className="font-mono text-xs dark:text-slate-300">{formatPHP(r.total)}</span>, exportValue: r => String(r.total) },
  { key: 'balance',       header: 'Balance',       align: 'right', render: r => <span className={`font-mono text-xs font-semibold ${r.balance > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatPHP(r.balance)}</span>, exportValue: r => String(r.balance) },
  { key: 'status',        header: 'Status',        render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status.replace(/_/g,' ')}</span>, exportValue: r => r.status },
];

export default function BillsPage() {
  const [rows, setRows]     = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [status, setStatus] = useState<string>('all');
  const [page, setPage]     = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true); setPage(1);
    const q = status === 'all' ? `/ap/bills?company_id=${cid}&limit=500` : `/ap/bills?company_id=${cid}&status=${status}&limit=500`;
    api.get<{ data: BillRow[] }>(q).then(r => setRows(r.data)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Bills</h1><p className="text-sm text-slate-600 dark:text-slate-400">Vendor invoices and AP balances.</p></div>
        <Link href="/dashboard/ap/bills/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New bill</Link>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map(s => <button key={s} onClick={() => setStatus(s)} className={`rounded px-3 py-1 text-xs font-medium ${status===s?'bg-brand-600 text-white':'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{s.replace(/_/g,' ')}</button>)}
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <DataTable id="ap-bills" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="ap-bills">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
