"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface IsRow {
  account_type: string; account_code: string; account_name: string;
  normal_side: string; period_debit: number; period_credit: number; net_amount: number;
}
interface IsResponse {
  start_date: string; end_date: string; rows: IsRow[];
  by_type: Record<string, IsRow[]>;
  total_revenue: number; total_expenses: number; net_income: number; duration_ms: number;
}

export default function IncomeStatementPage() {
  const [companyId, setCompanyId] = useState('');
  const now = new Date();
  const [startDate, setStartDate] = useState(`${now.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));
  const [data, setData] = useState<IsResponse | null>(null);
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
      const qs = new URLSearchParams({ company_id: companyId, start_date: startDate, end_date: endDate });
      const res = await api.get(`/api/v1/reports/income-statement?${qs}`) as IsResponse;
      setData(res);
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (companyId) run(); }, [companyId]);

  const fmt = (n: number) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const revenue  = data?.rows.filter((r) => r.normal_side === 'credit') ?? [];
  const expenses = data?.rows.filter((r) => r.normal_side === 'debit')  ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Income Statement</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Profit & Loss for a period</p>
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
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}

      {data && (
        <>
          {/* Summary KPIs */}
          <div className="mb-4 grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Total Revenue</div>
              <div className="text-xl font-bold text-green-700 dark:text-green-300">₱ {fmt(data.total_revenue)}</div>
            </div>
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Total Expenses</div>
              <div className="text-xl font-bold text-red-700 dark:text-red-300">₱ {fmt(data.total_expenses)}</div>
            </div>
            <div className={`rounded-lg border p-4 ${data.net_income >= 0 ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20' : 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20'}`}>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Net Income</div>
              <div className={`text-xl font-bold ${data.net_income >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-orange-700 dark:text-orange-300'}`}>
                ₱ {fmt(data.net_income)}
              </div>
            </div>
          </div>

          {/* Revenue section */}
          <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs font-bold uppercase tracking-wide text-green-800 dark:text-green-300">Revenue</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-right">Type</th>
                  <th className="px-3 py-2 text-right">Amount (₱)</th>
                </tr>
              </thead>
              <tbody>
                {revenue.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No revenue accounts with activity</td></tr>}
                {revenue.map((r) => (
                  <tr key={r.account_code} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{r.account_code}</td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{r.account_name}</td>
                    <td className="px-3 py-2 text-right text-xs text-slate-500">{r.account_type}</td>
                    <td className="px-3 py-2 text-right font-mono text-green-700 dark:text-green-400">{fmt(r.net_amount)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20">
                  <td colSpan={3} className="px-3 py-2 text-sm font-bold text-green-800 dark:text-green-300">Total Revenue</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-green-800 dark:text-green-300">{fmt(data.total_revenue)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Expense section */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs font-bold uppercase tracking-wide text-red-800 dark:text-red-300">Expenses</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-right">Type</th>
                  <th className="px-3 py-2 text-right">Amount (₱)</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No expense accounts with activity</td></tr>}
                {expenses.map((r) => (
                  <tr key={r.account_code} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{r.account_code}</td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{r.account_name}</td>
                    <td className="px-3 py-2 text-right text-xs text-slate-500">{r.account_type}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-700 dark:text-red-400">{fmt(r.net_amount)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20">
                  <td colSpan={3} className="px-3 py-2 text-sm font-bold text-red-800 dark:text-red-300">Total Expenses</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-red-800 dark:text-red-300">{fmt(data.total_expenses)}</td>
                </tr>
                <tr className="border-t-2 border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-700">
                  <td colSpan={3} className="px-3 py-2 text-sm font-bold text-slate-800 dark:text-slate-200">NET INCOME</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold text-lg ${data.net_income >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-orange-700 dark:text-orange-300'}`}>
                    {fmt(data.net_income)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
