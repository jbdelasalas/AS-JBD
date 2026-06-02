'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface PaymentRow {
  id: string; receipt_no: string; payment_date: string; customer_name: string; customer_code: string;
  payment_method: string; amount: number; unapplied_amount: number; is_advance: boolean; status: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:text-slate-300', posted: 'bg-blue-100 text-blue-700',
  cleared: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700',
};
const METHOD_LABELS: Record<string, string> = { cash:'Cash', check:'Check', bank_transfer:'Bank Transfer', credit_card:'Credit Card', online:'Online' };
const STATUSES = ['all','draft','posted','cleared','cancelled'] as const;

const COLUMNS: ColDef<PaymentRow>[] = [
  { key: 'receipt_no',       header: 'OR No.',      render: r => <><Link href={`/dashboard/ar/collections/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">{r.receipt_no}</Link>{r.is_advance && <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">ADV</span>}</>, exportValue: r => r.receipt_no },
  { key: 'payment_date',     header: 'Date',        render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.payment_date)}</span>, exportValue: r => formatDate(r.payment_date) },
  { key: 'customer_name',    header: 'Customer',    render: r => <><div className="font-medium text-slate-900 dark:text-slate-100">{r.customer_name}</div><div className="text-xs text-slate-500">{r.customer_code}</div></>, exportValue: r => r.customer_name },
  { key: 'payment_method',   header: 'Method',      render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{METHOD_LABELS[r.payment_method] ?? r.payment_method}</span>, exportValue: r => METHOD_LABELS[r.payment_method] ?? r.payment_method },
  { key: 'amount',           header: 'Amount',      align: 'right', render: r => <span className="font-mono text-xs font-semibold">{formatPHP(r.amount)}</span>, exportValue: r => String(r.amount) },
  { key: 'unapplied_amount', header: 'Unapplied',   align: 'right', render: r => r.unapplied_amount > 0 ? <span className="font-mono text-xs text-amber-700">{formatPHP(r.unapplied_amount)}</span> : <span className="text-slate-400">—</span>, exportValue: r => String(r.unapplied_amount) },
  { key: 'status',           header: 'Status',      render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status}</span>, exportValue: r => r.status },
];

export default function CollectionsPage() {
  const [rows, setRows]     = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [status, setStatus] = useState<string>('all');
  const [page, setPage]     = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true); setPage(1);
    const q = status === 'all' ? `/ar/collections?company_id=${cid}&limit=500` : `/ar/collections?company_id=${cid}&status=${status}&limit=500`;
    api.get<{ data: PaymentRow[] }>(q).then(r => setRows(r.data)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Collections</h1><p className="text-sm text-slate-600 dark:text-slate-400">Customer payments and official receipts.</p></div>
        <Link href="/dashboard/ar/collections/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New collection</Link>
      </div>
      <div className="mb-3 flex gap-1.5">
        {STATUSES.map(s => <button key={s} onClick={() => setStatus(s)} className={`rounded px-3 py-1 text-xs font-medium ${status===s?'bg-brand-600 text-white':'border border-slate-300 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50'}`}>{s}</button>)}
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <DataTable id="ar-collections" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="ar-collections">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
