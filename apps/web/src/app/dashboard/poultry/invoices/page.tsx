'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';

interface Row { id: string; doc_no: string; invoice_date: string; due_date: string | null; status: string; payment_status: string; total_amount: number; paid_amount: number; balance_due: number; customer_name: string; customer_code: string; }
const S: Record<string, string> = { draft: 'bg-slate-100 text-slate-600', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700' };
const PS: Record<string, string> = { unpaid: 'bg-red-100 text-red-700', partial: 'bg-amber-100 text-amber-700', paid: 'bg-emerald-100 text-emerald-700' };

export default function InvoicesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const PAGE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true);
    api.get<{ data: Row[]; total: number }>(`/poultry/invoices?company_id=${cid}&limit=${PAGE}&offset=${(page - 1) * PAGE}${status ? `&status=${status}` : ''}`)
      .then(r => { setRows(r.data); setTotal(r.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [status, page]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Sales Invoices</h1><p className="text-sm text-slate-500">Poultry sales invoices and AR.</p></div>
        <Link href="/dashboard/poultry/invoices/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New Invoice</Link>
      </div>
      <div className="mb-3 flex gap-2 text-xs">
        {['', 'draft', 'posted', 'voided'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`rounded px-3 py-1 ${status === s ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{s || 'All'}</button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Invoice No.</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Due Date</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Payment</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="py-8 text-center text-slate-400 text-xs">Loading…</td></tr>
              : !rows.length ? <tr><td colSpan={8} className="py-8 text-center text-slate-400 text-xs">No records found.</td></tr>
              : rows.map(r => (
                <tr key={r.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2"><Link href={`/dashboard/poultry/invoices/${r.id}`} className="font-mono text-brand-600 hover:underline">{r.doc_no}</Link></td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{r.customer_code} — {r.customer_name}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDate(r.invoice_date)}</td>
                  <td className="px-3 py-2 text-slate-500">{r.due_date ? formatDate(r.due_date) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatPHP(r.total_amount)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{formatPHP(r.balance_due)}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${S[r.status] ?? ''}`}>{r.status}</span></td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${PS[r.payment_status] ?? 'bg-slate-100 text-slate-600'}`}>{r.payment_status}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
        <Pagination page={page} total={total} pageSize={PAGE} onChange={setPage} />
      </div>
    </div>
  );
}
