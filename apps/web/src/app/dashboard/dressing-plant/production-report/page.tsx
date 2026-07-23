'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Row {
  id: string;
  date: string;
  time: string;
  batch_number: string;
  product_code: string;
  product_name: string;
  size_code: string | null;
  head: number;
  packs: number;
  weight_kg: string;
}
interface Totals { rows: number; head: number; packs: number; weight_kg: number; }

function today() { return new Date().toISOString().slice(0, 10); }
function monthStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }

export default function ProductionReportPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals>({ rows: 0, head: 0, packs: 0, weight_kg: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ company_id: companyId, from, to });
    api.get<{ data: Row[]; totals: Totals }>(`/dressing-plant/production-report?${qs.toString()}`)
      .then((r) => { setRows(r.data); setTotals(r.totals); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId, from, to]);

  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    const header = ['Date', 'Time', 'Batch Number', 'Product Code', 'Size', 'Head', 'Packs', 'Weight(kg)'];
    const lines = rows.map((r) => [
      r.date, r.time, r.batch_number, r.product_code, r.size_code ?? '',
      r.head, r.packs, Number(r.weight_kg).toFixed(2),
    ]);
    lines.push(['', '', '', '', 'TOTAL', String(totals.head), String(totals.packs), totals.weight_kg.toFixed(2)]);
    const csv = [header, ...lines]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `production-report_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Production Report</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Detailed processed-production log — every recorded entry with date, time, batch, product code, head and weight.</p>
        </div>
        <button onClick={exportCsv} disabled={rows.length === 0}
          className="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">
          Export CSV
        </button>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <button onClick={load} className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Run</button>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{totals.rows} rows</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Batch Number</th>
              <th className="px-3 py-2 text-left">Product Code</th>
              <th className="px-3 py-2 text-left">Size</th>
              <th className="px-3 py-2 text-right">Head</th>
              <th className="px-3 py-2 text-right">Weight(kg)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">No production records in this range.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-1.5 font-mono text-xs text-slate-700 dark:text-slate-300">{r.date}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-700 dark:text-slate-300">{r.time}</td>
                <td className="px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200">{r.batch_number}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-800 dark:text-slate-200">{r.product_code}</td>
                <td className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400">{r.size_code ?? '—'}</td>
                <td className="px-3 py-1.5 text-right text-xs text-slate-700 dark:text-slate-300">{r.head}</td>
                <td className="px-3 py-1.5 text-right text-xs text-slate-700 dark:text-slate-300">{Number(r.weight_kg).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-xs font-medium dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300" colSpan={5}>TOTAL — {totals.rows} entries</td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{totals.head.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{totals.weight_kg.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
