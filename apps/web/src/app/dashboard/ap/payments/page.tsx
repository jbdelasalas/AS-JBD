'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface PaymentRow {
  id: string; voucher_no: string; payment_date: string; payment_method: string;
  reference: string | null; amount: number; status: string; supplier_name: string; supplier_code: string;
}

const STATUS_STYLES: Record<string, string> = { draft:'bg-slate-100 text-slate-700', posted:'bg-emerald-100 text-emerald-700', voided:'bg-red-100 text-red-700' };
const STATUSES = ['all','draft','posted','voided'] as const;

const COLUMNS: ColDef<PaymentRow>[] = [
  { key: 'voucher_no',      header: 'Voucher No.',  render: r => <Link href={`/dashboard/ap/payments/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">{r.voucher_no}</Link>, exportValue: r => r.voucher_no },
  { key: 'payment_date',    header: 'Date',         render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.payment_date)}</span>, exportValue: r => formatDate(r.payment_date) },
  { key: 'supplier_name',   header: 'Supplier',     render: r => <><div className="font-medium text-slate-900 dark:text-slate-100">{r.supplier_name}</div><div className="text-xs text-slate-500">{r.supplier_code}</div></>, exportValue: r => r.supplier_name },
  { key: 'payment_method',  header: 'Method',       render: r => <span className="text-xs capitalize text-slate-600 dark:text-slate-400">{r.payment_method.replace(/_/g,' ')}</span>, exportValue: r => r.payment_method },
  { key: 'reference',       header: 'Reference',    render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.reference ?? '—'}</span>, exportValue: r => r.reference ?? '' },
  { key: 'amount',          header: 'Amount',       align: 'right', render: r => <span className="font-mono text-xs font-semibold dark:text-slate-300">{formatPHP(r.amount)}</span>, exportValue: r => String(r.amount) },
  { key: 'status',          header: 'Status',       render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status}</span>, exportValue: r => r.status },
];

export default function PaymentsPage() {
  const [rows, setRows]     = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [status, setStatus] = useState<string>('all');
  const [page, setPage]     = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true); setPage(1);
    const q = status === 'all' ? `/ap/payments?company_id=${cid}&limit=500` : `/ap/payments?company_id=${cid}&status=${status}&limit=500`;
    api.get<{ data: PaymentRow[] }>(q).then(r => setRows(r.data)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Supplier Payments</h1><p className="text-sm text-slate-600 dark:text-slate-400">Check vouchers and bank payment records.</p></div>
        <Link href="/dashboard/ap/payments/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New payment</Link>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map(s => <button key={s} onClick={() => setStatus(s)} className={`rounded px-3 py-1 text-xs font-medium ${status===s?'bg-brand-600 text-white':'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{s}</button>)}
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <DataTable id="ap-payments" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="ap-payments">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
