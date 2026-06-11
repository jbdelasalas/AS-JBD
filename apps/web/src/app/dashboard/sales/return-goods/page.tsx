'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface ReturnGood {
  id: string; return_no: string; return_date: string; status: string;
  dr_no: string | null; customer_name: string | null; reason: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  saved:  'bg-slate-100 text-slate-700',
  posted: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

export default function ReturnGoodsListPage() {
  const [rows, setRows]   = useState<ReturnGood[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage]   = useState(0);
  const limit = 50;

  const load = useCallback(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true);
    api.get<{ data: ReturnGood[]; total: number }>(
      `/sales/return-goods?company_id=${cid}&limit=${limit}&offset=${page * limit}`,
    ).then(r => { setRows(r.data ?? []); setTotal(r.total ?? 0); })
     .catch(() => {})
     .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Return Goods</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Sales returns created from posted Delivery Receipts</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <tr>
              {['Return #', 'Return Date', 'DR #', 'Customer', 'Reason', 'Status', ''].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 dark:text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-xs">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-xs">No return goods found</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-4 py-2.5 font-mono text-sm font-semibold text-brand-700 dark:text-brand-400">
                  <Link href={`/dashboard/sales/return-goods/${r.id}`} className="hover:underline">{r.return_no}</Link>
                </td>
                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                  {r.return_date ? new Date(r.return_date).toLocaleDateString('en-PH') : '—'}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.dr_no ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{r.customer_name ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 max-w-xs truncate">{r.reason ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/dashboard/sales/return-goods/${r.id}`}
                    className="text-xs text-brand-600 hover:underline dark:text-brand-400">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > limit && (
          <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center justify-between text-xs text-slate-500">
            <span>{total} total</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="rounded border px-2 py-1 disabled:opacity-40">Prev</button>
              <span className="px-1">Page {page + 1} / {Math.ceil(total / limit)}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total}
                className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
