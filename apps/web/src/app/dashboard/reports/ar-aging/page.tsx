"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface AgingRow {
  customer_id: string; customer_name: string; customer_tin: string;
  current_amt: number; days_1_30: number; days_31_60: number;
  days_61_90: number; days_91_plus: number; total_outstanding: number;
}
interface AgingResponse {
  as_of: string; rows: AgingRow[];
  grand_total: { current_amt: number; days_1_30: number; days_31_60: number; days_61_90: number; days_91_plus: number; total_outstanding: number };
  duration_ms: number;
}

export default function ArAgingPage() {
  const [companyId, setCompanyId] = useState('');
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<AgingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('selected_company_id');
    if (stored) setCompanyId(stored);
  }, []);

  async function run() {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ company_id: companyId, as_of: asOf + 'T23:59:59' });
      const res = await api.get(`/api/v1/reports/ar-aging?${qs}`) as AgingResponse;
      setData(res);
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (companyId) run(); }, [companyId]);

  const fmt = (n: number) => n === 0 ? '—' : n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const filtered = (data?.rows ?? []).filter((r) =>
    !search || r.customer_name.toLowerCase().includes(search.toLowerCase()) || r.customer_tin?.includes(search)
  );

  const gt = data?.grand_total;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">AR Aging</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Outstanding invoices by age bucket</p>
        </div>
        <button onClick={run} disabled={loading}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Running…' : 'Run Report'}
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">As of Date</label>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
            className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-sm text-slate-900 dark:text-slate-100" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Search</label>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer or TIN…"
            className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 w-48" />
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}

      {gt && (
        <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            { label: 'Current', val: gt.current_amt, color: 'text-green-700 dark:text-green-300' },
            { label: '1–30 days', val: gt.days_1_30, color: 'text-yellow-700 dark:text-yellow-300' },
            { label: '31–60 days', val: gt.days_31_60, color: 'text-orange-600 dark:text-orange-300' },
            { label: '61–90 days', val: gt.days_61_90, color: 'text-red-600 dark:text-red-400' },
            { label: '91+ days', val: gt.days_91_plus, color: 'text-red-800 dark:text-red-300' },
            { label: 'Total', val: gt.total_outstanding, color: 'text-slate-900 dark:text-slate-100' },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{k.label}</div>
              <div className={`text-sm font-bold ${k.color}`}>₱ {fmt(k.val)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Customer</th>
              <th className="px-3 py-2 text-left font-medium">TIN</th>
              <th className="px-3 py-2 text-right font-medium">Current</th>
              <th className="px-3 py-2 text-right font-medium">1–30</th>
              <th className="px-3 py-2 text-right font-medium">31–60</th>
              <th className="px-3 py-2 text-right font-medium">61–90</th>
              <th className="px-3 py-2 text-right font-medium">91+</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Running report…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No outstanding AR as of this date.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.customer_id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2 text-slate-800 dark:text-slate-200 font-medium">{r.customer_name}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.customer_tin || '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-green-700 dark:text-green-400">{fmt(r.current_amt)}</td>
                <td className="px-3 py-2 text-right font-mono text-yellow-700 dark:text-yellow-400">{fmt(r.days_1_30)}</td>
                <td className="px-3 py-2 text-right font-mono text-orange-600 dark:text-orange-400">{fmt(r.days_31_60)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-600 dark:text-red-400">{fmt(r.days_61_90)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-800 dark:text-red-300">{fmt(r.days_91_plus)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">{fmt(r.total_outstanding)}</td>
              </tr>
            ))}
            {gt && filtered.length > 0 && (
              <tr className="border-t-2 border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-700">
                <td colSpan={2} className="px-3 py-2 text-sm font-bold text-slate-800 dark:text-slate-200">TOTAL</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-green-700 dark:text-green-300">{fmt(gt.current_amt)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-yellow-700 dark:text-yellow-300">{fmt(gt.days_1_30)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-orange-600 dark:text-orange-300">{fmt(gt.days_31_60)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-red-600 dark:text-red-400">{fmt(gt.days_61_90)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-red-800 dark:text-red-300">{fmt(gt.days_91_plus)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-200">{fmt(gt.total_outstanding)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <div className="mt-2 text-right text-xs text-slate-400">
          {filtered.length} customers · computed in {data.duration_ms}ms
        </div>
      )}
    </div>
  );
}
