'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';

interface Row { id: string; doc_no: string; start_date: string; expected_end_date: string | null; status: string; heads_in: number; heads_available: number; total_mortality: number; heads_harvested: number; item_name: string; building_name: string | null; batch_no: string; }
const S: Record<string, string> = { active: 'bg-emerald-100 text-emerald-700', harvesting: 'bg-amber-100 text-amber-700', completed: 'bg-blue-100 text-blue-700', closed: 'bg-slate-100 text-slate-600' };

export default function GrowCyclesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const PAGE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true);
    api.get<{ data: Row[]; total: number }>(`/poultry/grow-cycles?company_id=${cid}&limit=${PAGE}&offset=${(page - 1) * PAGE}${status ? `&status=${status}` : ''}`)
      .then(r => { setRows(r.data); setTotal(r.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [status, page]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Grow Cycles</h1><p className="text-sm text-slate-500">Track growing batches from start to harvest.</p></div>
        <Link href="/dashboard/poultry/grow-cycles/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New Grow Cycle</Link>
      </div>
      <div className="mb-3 flex gap-2 text-xs">
        {['', 'active', 'harvesting', 'completed', 'closed'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`rounded px-3 py-1 ${status === s ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{s || 'All'}</button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Doc No.</th>
              <th className="px-3 py-2 text-left">Batch</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Building</th>
              <th className="px-3 py-2 text-left">Start</th>
              <th className="px-3 py-2 text-right">Heads In</th>
              <th className="px-3 py-2 text-right">Available</th>
              <th className="px-3 py-2 text-right">Mortality</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={9} className="py-8 text-center text-slate-400 text-xs">Loading…</td></tr>
              : !rows.length ? <tr><td colSpan={9} className="py-8 text-center text-slate-400 text-xs">No cycles found.</td></tr>
              : rows.map(r => (
                <tr key={r.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2"><Link href={`/dashboard/poultry/grow-cycles/${r.id}`} className="font-mono text-brand-600 hover:underline">{r.doc_no}</Link></td>
                  <td className="px-3 py-2 font-mono text-slate-500 text-xs">{r.batch_no}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{r.item_name}</td>
                  <td className="px-3 py-2 text-slate-500">{r.building_name ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDate(r.start_date)}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(r.heads_in).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-600 font-medium">{Number(r.heads_available).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-500">{Number(r.total_mortality).toLocaleString()}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${S[r.status] ?? 'bg-slate-100 text-slate-600'}`}>{r.status}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
        <Pagination page={page} total={total} pageSize={PAGE} onChange={setPage} />
      </div>
    </div>
  );
}
