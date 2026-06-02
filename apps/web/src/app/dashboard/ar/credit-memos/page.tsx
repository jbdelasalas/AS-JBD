'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface CMRow {
  id: string; cm_no: string; cm_date: string; customer_name: string;
  original_invoice_no: string | null; total: number; amount_applied: number; unapplied_amount: number; status: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft:'bg-slate-100 text-slate-700 dark:text-slate-300', pending_approval:'bg-amber-100 text-amber-700',
  approved:'bg-blue-100 text-blue-700', applied:'bg-emerald-100 text-emerald-700', cancelled:'bg-red-100 text-red-700',
};
const STATUSES = ['all','draft','pending_approval','approved','applied','cancelled'] as const;

const COLUMNS: ColDef<CMRow>[] = [
  { key: 'cm_no',               header: 'CM No.',         render: r => <Link href={`/dashboard/ar/credit-memos/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">{r.cm_no}</Link>, exportValue: r => r.cm_no },
  { key: 'cm_date',             header: 'Date',           render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.cm_date)}</span>, exportValue: r => formatDate(r.cm_date) },
  { key: 'customer_name',       header: 'Customer',       render: r => <span className="font-medium text-slate-900 dark:text-slate-100">{r.customer_name}</span>, exportValue: r => r.customer_name },
  { key: 'original_invoice_no', header: 'Orig. Invoice',  render: r => <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{r.original_invoice_no ?? '—'}</span>, exportValue: r => r.original_invoice_no ?? '' },
  { key: 'total',               header: 'Total',          align: 'right', render: r => <span className="font-mono text-xs">{formatPHP(r.total)}</span>, exportValue: r => String(r.total) },
  { key: 'unapplied_amount',    header: 'Unapplied',      align: 'right', render: r => r.unapplied_amount > 0 ? <span className="font-mono text-xs font-semibold text-amber-700">{formatPHP(r.unapplied_amount)}</span> : <span className="text-slate-400 text-xs">—</span>, exportValue: r => String(r.unapplied_amount) },
  { key: 'status',              header: 'Status',         render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status.replace(/_/g,' ')}</span>, exportValue: r => r.status },
];

export default function CreditMemosPage() {
  const [rows, setRows]     = useState<CMRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [status, setStatus] = useState<string>('all');
  const [page, setPage]     = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true); setPage(1);
    const q = status === 'all' ? `/ar/credit-memos?company_id=${cid}&limit=500` : `/ar/credit-memos?company_id=${cid}&status=${status}&limit=500`;
    api.get<{ data: CMRow[] }>(q).then(r => setRows(r.data)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">AR Credit Memos</h1><p className="text-sm text-slate-600 dark:text-slate-400">Issue and apply customer credit adjustments.</p></div>
        <Link href="/dashboard/ar/credit-memos/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New credit memo</Link>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map(s => <button key={s} onClick={() => setStatus(s)} className={`rounded px-3 py-1 text-xs font-medium ${status===s?'bg-brand-600 text-white':'border border-slate-300 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50'}`}>{s.replace(/_/g,' ')}</button>)}
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <DataTable id="ar-credit-memos" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="ar-credit-memos">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
