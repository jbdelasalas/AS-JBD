"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface TbRow {
  account_code: string; account_name: string; account_type: string;
  is_balance_sheet: boolean; normal_side: string;
  period_debit: number; period_credit: number; ending_balance: number;
}
interface TbResponse {
  as_of: string; rows: TbRow[];
  total_debit: number; total_credit: number; reconciles: boolean; duration_ms: number;
}

export default function TrialBalancePage() {
  const [companyId, setCompanyId] = useState('');
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [excludeZero, setExcludeZero] = useState(true);
  const [data, setData] = useState<TbResponse | null>(null);
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
      const qs = new URLSearchParams({
        company_id: companyId, as_of: asOf + 'T23:59:59',
        exclude_zero: String(excludeZero),
      });
      const res = await api.get(`/api/v1/reports/trial-balance?${qs}`) as TbResponse;
      setData(res);
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (companyId) run(); }, [companyId]);

  const filtered = (data?.rows ?? []).filter((r) =>
    !search || r.account_code.includes(search) || r.account_name.toLowerCase().includes(search.toLowerCase())
  );

  // Group by account type
  const groups: Record<string, TbRow[]> = {};
  for (const r of filtered) {
    if (!groups[r.account_type]) groups[r.account_type] = [];
    groups[r.account_type].push(r);
  }

  const fmt = (n: number) => n === 0 ? '—' : n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Trial Balance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Account balances as of a point in time</p>
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
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={excludeZero} onChange={(e) => setExcludeZero(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300" />
            Hide zero balances
          </label>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Search</label>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Code or name…"
            className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 w-44" />
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Reconciliation banner */}
      {data && (
        <div className={`mb-4 rounded-lg border px-4 py-3 flex items-center justify-between ${data.reconciles ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'}`}>
          <div className="flex items-center gap-3">
            <span className={`text-xl ${data.reconciles ? 'text-green-600' : 'text-red-600'}`}>{data.reconciles ? '✓' : '⚠'}</span>
            <div>
              <div className={`text-sm font-semibold ${data.reconciles ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
                {data.reconciles ? 'Balanced — Debits equal Credits' : 'Out of balance — investigate posting errors'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Computed in {data.duration_ms}ms · {filtered.length} accounts
              </div>
            </div>
          </div>
          <div className="text-right text-sm font-mono">
            <div className="text-slate-700 dark:text-slate-300">Debit: <strong>{fmt(data.total_debit)}</strong></div>
            <div className="text-slate-700 dark:text-slate-300">Credit: <strong>{fmt(data.total_credit)}</strong></div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Code</th>
              <th className="px-3 py-2 text-left font-medium">Account Name</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Debit</th>
              <th className="px-3 py-2 text-right font-medium">Credit</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Running report…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No data. Run the report or check migration 017.</td></tr>}
            {Object.entries(groups).map(([type, rows]) => (
              <>
                <tr key={`h-${type}`} className="bg-slate-100 dark:bg-slate-700/50">
                  <td colSpan={6} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    {type}
                  </td>
                </tr>
                {rows.map((r) => (
                  <tr key={r.account_code} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.account_code}</td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{r.account_name}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.is_balance_sheet ? 'BS' : 'IS'}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700 dark:text-slate-300">{r.period_debit > 0 ? fmt(r.period_debit) : ''}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700 dark:text-slate-300">{r.period_credit > 0 ? fmt(r.period_credit) : ''}</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${r.ending_balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-200'}`}>
                      {fmt(Math.abs(r.ending_balance))}{r.ending_balance < 0 ? ' CR' : ''}
                    </td>
                  </tr>
                ))}
                <tr key={`f-${type}`} className="border-t border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800">
                  <td colSpan={3} className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">Subtotal — {type}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">{fmt(rows.reduce((s, r) => s + r.period_debit, 0))}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">{fmt(rows.reduce((s, r) => s + r.period_credit, 0))}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">{fmt(rows.reduce((s, r) => s + r.ending_balance, 0))}</td>
                </tr>
              </>
            ))}
            {data && filtered.length > 0 && (
              <tr className="border-t-2 border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-700">
                <td colSpan={3} className="px-3 py-2 text-sm font-bold text-slate-800 dark:text-slate-200">TOTAL</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-200">{fmt(data.total_debit)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-200">{fmt(data.total_credit)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-200">{fmt(data.total_debit - data.total_credit)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
