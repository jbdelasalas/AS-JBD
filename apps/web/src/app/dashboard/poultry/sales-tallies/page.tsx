'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';

interface Row { id: string; doc_no: string; transfer_date: string; status: string; customer_name: string | null; customer_code: string | null; ref_no: string | null; delivery_ref_no: string | null; plate_number: string | null; driver: string | null; }
const S: Record<string, string> = { saved: 'bg-slate-100 text-slate-600', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700' };

export default function SalesTalliesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const PAGE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true);
    api.get<{ data: Row[]; total: number }>(`/poultry/sales-tallies?company_id=${cid}&limit=${PAGE}&offset=${(page - 1) * PAGE}${status ? `&status=${status}` : ''}`)
      .then(r => { setRows(r.data); setTotal(r.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [status, page]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Sales Tally Sheet</h1><p className="text-sm text-slate-500">Live chicken sales tally dispatch.</p></div>
        <Link href="/dashboard/poultry/sales-tallies/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New Sales Tally</Link>
      </div>
      <div className="mb-3 flex gap-2 text-xs">
        {['', 'saved', 'posted', 'voided'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`rounded px-3 py-1 ${status === s ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{s || 'All'}</button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Doc No.</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Ref No.</th>
              <th className="px-3 py-2 text-left">Driver</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="py-8 text-center text-slate-400 text-xs">Loading…</td></tr>
              : !rows.length ? <tr><td colSpan={6} className="py-8 text-center text-slate-400 text-xs">No records found.</td></tr>
              : rows.map(r => (
                <tr key={r.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2"><Link href={`/dashboard/poultry/sales-tallies/${r.id}`} className="font-mono text-brand-600 hover:underline">{r.doc_no}</Link></td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{r.customer_code ? `${r.customer_code} — ${r.customer_name}` : '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDate(r.transfer_date)}</td>
                  <td className="px-3 py-2 text-slate-500">{r.ref_no ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{r.driver ?? '—'}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${S[r.status] ?? ''}`}>{r.status}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
        <Pagination page={page} total={total} pageSize={PAGE} onChange={setPage} />
      </div>
    </div>
  );
}
