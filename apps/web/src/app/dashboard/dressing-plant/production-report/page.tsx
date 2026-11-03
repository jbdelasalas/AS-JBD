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
interface Batch { id: string; batch_no: string; client_name: string; received_at: string | null; output_lines: number; }

const kg3 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function today() { return new Date().toISOString().slice(0, 10); }
function monthStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }

export default function ProductionReportPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals>({ rows: 0, head: 0, packs: 0, weight_kg: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  // A chosen batch shows that whole batch, whatever the dates.
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState('');

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams(batchId ? { company_id: companyId, job_order_id: batchId } : { company_id: companyId, from, to });
    api.get<{ data: Row[]; totals: Totals }>(`/dressing-plant/production-report?${qs.toString()}`)
      .then((r) => { setRows(r.data); setTotals(r.totals); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId, from, to, batchId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: Batch[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => setBatches(r.data.filter((b) => Number(b.output_lines) > 0))).catch(() => {});
  }, [companyId]);

  const batch = batches.find((b) => b.id === batchId);
  // Per-product summary of what is on screen.
  const summary = [...rows.reduce((m, r) => {
    const t = m.get(r.product_name) ?? { product: r.product_name, packs: 0, head: 0, weight: 0 };
    t.packs += Number(r.packs || 0); t.head += Number(r.head || 0); t.weight += Number(r.weight_kg || 0);
    return m.set(r.product_name, t);
  }, new Map<string, { product: string; packs: number; head: number; weight: number }>()).values()]
    .sort((a, b) => a.product.localeCompare(b.product, undefined, { numeric: true }));

  function exportCsv() {
    const header = ['Date', 'Time', 'Batch Number', 'Product Code', 'Head', 'Packs', 'Weight(kg)'];
    const lines = rows.map((r) => [
      r.date, r.time, r.batch_number, r.product_name,
      r.head, r.packs, Number(r.weight_kg).toFixed(3),
    ]);
    lines.push(['', '', '', 'TOTAL', String(totals.head), String(totals.packs), totals.weight_kg.toFixed(3)]);
    const csv = [header, ...lines]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = batch ? `production-report_${batch.batch_no}.csv` : `production-report_${from}_to_${to}.csv`;
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
        <div className="min-w-[240px]">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Batch</label>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            <option value="">All batches (by date)</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_no} — {b.client_name}</option>)}
          </select>
        </div>
        <div className={batchId ? 'opacity-40' : ''}>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">From</label>
          <input type="date" value={from} disabled={!!batchId} onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className={batchId ? 'opacity-40' : ''}>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">To</label>
          <input type="date" value={to} disabled={!!batchId} onChange={(e) => setTo(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <button onClick={load} className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Run</button>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{totals.rows} rows</span>
      </div>

      {summary.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 dark:border-slate-700 dark:text-slate-200">
            Summary per product{batch ? ` — ${batch.batch_no} · ${batch.client_name}` : ` — ${from} to ${to}`}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-right">Packs</th>
                <th className="px-3 py-2 text-right">Head</th>
                <th className="px-3 py-2 text-right">Weight(kg)</th>
                <th className="px-3 py-2 text-right">% of kg</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((t) => (
                <tr key={t.product} className="border-t border-slate-100 text-xs dark:border-slate-800">
                  <td className="px-3 py-1.5 text-slate-800 dark:text-slate-200">{t.product}</td>
                  <td className="px-3 py-1.5 text-right text-slate-700 dark:text-slate-300">{t.packs.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right text-slate-700 dark:text-slate-300">{t.head.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-slate-900 dark:text-slate-100">{kg3(t.weight)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{totals.weight_kg ? ((t.weight / totals.weight_kg) * 100).toFixed(1) : '0.0'}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">TOTAL — {summary.length} products</td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{totals.packs.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{totals.head.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{kg3(totals.weight_kg)}</td>
                <td className="px-3 py-2 text-right text-slate-500">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Batch Number</th>
              <th className="px-3 py-2 text-left">Product Code</th>
              <th className="px-3 py-2 text-right">Head</th>
              <th className="px-3 py-2 text-right">Weight(kg)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">No production records in this range.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-1.5 font-mono text-xs text-slate-700 dark:text-slate-300">{r.date}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-700 dark:text-slate-300">{r.time}</td>
                <td className="px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200">{r.batch_number}</td>
                <td className="px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200" title={r.product_code}>{r.product_name}</td>
                <td className="px-3 py-1.5 text-right text-xs text-slate-700 dark:text-slate-300">{r.head}</td>
                <td className="px-3 py-1.5 text-right text-xs text-slate-700 dark:text-slate-300">{kg3(Number(r.weight_kg))}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-xs font-medium dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300" colSpan={4}>TOTAL — {totals.rows} entries</td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{totals.head.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{kg3(totals.weight_kg)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
