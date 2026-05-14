"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface SummaryRow {
  period: string; doc_count: number; vatable: number; vat_amount: number;
  exempt: number; zero_rated: number; gross_sales: number; net_sales: number;
}
interface DetailRow {
  document_type: string; document_no: string; transaction_date: string;
  customer_name: string; customer_tin: string;
  vatable_amount: number; vat_amount: number; vat_exempt_amount: number;
  zero_rated_amount: number; total_amount: number; net_amount: number; status: string;
}
interface SalesResponse {
  start_date: string; end_date: string; group_by: string;
  summary: SummaryRow[];
  totals: { doc_count: number; vatable: number; vat_amount: number; exempt: number; zero_rated: number; gross_sales: number; net_sales: number };
  detail: DetailRow[];
  duration_ms: number;
}

export default function SalesPage() {
  const [companyId, setCompanyId] = useState('');
  const now = new Date();
  const [startDate, setStartDate] = useState(`${now.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('month');
  const [showDetail, setShowDetail] = useState(false);
  const [data, setData] = useState<SalesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('selected_company_id');
    if (stored) setCompanyId(stored);
  }, []);

  async function run() {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({
        company_id: companyId, start_date: startDate, end_date: endDate,
        group_by: groupBy, detail: String(showDetail),
      });
      const res = await api.get(`/api/v1/reports/sales?${qs}`) as SalesResponse;
      setData(res);
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (companyId) run(); }, [companyId]);

  const fmt = (n: number) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = (n: number) => n.toLocaleString('en-PH');

  const t = data?.totals;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Sales Register</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Daily / monthly sales with VAT breakdown</p>
        </div>
        <button onClick={run} disabled={loading}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Running…' : 'Run Report'}
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">From</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-sm text-slate-900 dark:text-slate-100" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">To</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-sm text-slate-900 dark:text-slate-100" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Group By</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'day' | 'month')}
            className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-sm text-slate-900 dark:text-slate-100">
            <option value="month">Month</option>
            <option value="day">Day</option>
          </select>
        </div>
        <div className="flex items-end pb-0.5">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={showDetail} onChange={(e) => setShowDetail(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300" />
            Show transaction detail
          </label>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}

      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Gross Sales', val: t.gross_sales, color: 'text-slate-900 dark:text-slate-100' },
            { label: 'VATable Sales', val: t.vatable, color: 'text-blue-700 dark:text-blue-300' },
            { label: 'Output VAT', val: t.vat_amount, color: 'text-purple-700 dark:text-purple-300' },
            { label: 'Net Sales', val: t.net_sales, color: 'text-green-700 dark:text-green-300' },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{k.label}</div>
              <div className={`text-base font-bold ${k.color}`}>₱ {fmt(k.val)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Summary table */}
      <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Summary — by {groupBy}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Period</th>
              <th className="px-3 py-2 text-right font-medium"># Docs</th>
              <th className="px-3 py-2 text-right font-medium">Gross Sales</th>
              <th className="px-3 py-2 text-right font-medium">VATable</th>
              <th className="px-3 py-2 text-right font-medium">Output VAT</th>
              <th className="px-3 py-2 text-right font-medium">VAT-Exempt</th>
              <th className="px-3 py-2 text-right font-medium">Zero-Rated</th>
              <th className="px-3 py-2 text-right font-medium">Net Sales</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Running report…</td></tr>}
            {!loading && (data?.summary ?? []).length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No sales data for this period.</td></tr>
            )}
            {(data?.summary ?? []).map((r) => (
              <tr key={r.period} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.period}</td>
                <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">{fmtInt(r.doc_count)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">{fmt(r.gross_sales)}</td>
                <td className="px-3 py-2 text-right font-mono text-blue-700 dark:text-blue-400">{fmt(r.vatable)}</td>
                <td className="px-3 py-2 text-right font-mono text-purple-700 dark:text-purple-400">{fmt(r.vat_amount)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{fmt(r.exempt)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{fmt(r.zero_rated)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-green-700 dark:text-green-400">{fmt(r.net_sales)}</td>
              </tr>
            ))}
            {t && (data?.summary ?? []).length > 0 && (
              <tr className="border-t-2 border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-700">
                <td className="px-3 py-2 text-sm font-bold text-slate-800 dark:text-slate-200">TOTAL</td>
                <td className="px-3 py-2 text-right font-bold text-slate-800 dark:text-slate-200">{fmtInt(t.doc_count)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-200">{fmt(t.gross_sales)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-blue-700 dark:text-blue-300">{fmt(t.vatable)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-purple-700 dark:text-purple-300">{fmt(t.vat_amount)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-slate-700 dark:text-slate-300">{fmt(t.exempt)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-slate-700 dark:text-slate-300">{fmt(t.zero_rated)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-green-700 dark:text-green-300">{fmt(t.net_sales)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail table */}
      {showDetail && data && data.detail.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Transaction Detail ({data.detail.length} records)
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Doc Type</th>
                <th className="px-3 py-2 text-left font-medium">Doc No.</th>
                <th className="px-3 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-left font-medium">TIN</th>
                <th className="px-3 py-2 text-right font-medium">Gross</th>
                <th className="px-3 py-2 text-right font-medium">VAT</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {(data.detail as DetailRow[]).map((r, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{r.transaction_date?.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.document_type}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.document_no}</td>
                  <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{r.customer_name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.customer_tin || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700 dark:text-slate-300">{fmt(r.total_amount)}</td>
                  <td className="px-3 py-2 text-right font-mono text-purple-700 dark:text-purple-400">{fmt(r.vat_amount)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-green-700 dark:text-green-400">{fmt(r.net_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="mt-2 text-right text-xs text-slate-400">
          {data.summary.length} periods · computed in {data.duration_ms}ms
        </div>
      )}
    </div>
  );
}
