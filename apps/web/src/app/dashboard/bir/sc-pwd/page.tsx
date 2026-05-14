"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Pagination } from '@/components/Pagination';
import type { ScPwdTransaction } from '@perpet/shared';

const PAGE_SIZE = 15;

export default function BirScPwdPage() {
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<ScPwdTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [summary, setSummary] = useState<{ sc_pwd_type: string; total_discount: number; total_transactions: number }[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('selected_company_id');
    if (stored) setCompanyId(stored);
  }, []);

  useEffect(() => { if (companyId) load(); }, [companyId, page, filterType, filterFrom, filterTo]);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        company_id: companyId,
        limit: '500', offset: '0',
        ...(filterType && { sc_pwd_type: filterType }),
        ...(filterFrom && { date_from: filterFrom }),
        ...(filterTo && { date_to: filterTo }),
      });
      const res = await api.get(`/api/v1/bir/sc-pwd?${qs}`) as {
        data: ScPwdTransaction[];
        total: number;
        summary: { sc_pwd_type: string; total_discount: number; total_transactions: number }[];
      };
      setRows(res.data ?? []);
      setTotal(res.total ?? 0);
      setSummary(res.summary ?? []);
    } catch { setRows([]); } finally { setLoading(false); }
  }

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const scTotal = summary.find((s) => s.sc_pwd_type === 'SC');
  const pwdTotal = summary.find((s) => s.sc_pwd_type === 'PWD');

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">SC / PWD Transactions</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Senior citizen (RA 9994) and PWD (RA 10754) discount register</p>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{scTotal?.total_transactions ?? 0}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">SC Transactions</div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <div className="text-2xl font-bold text-purple-700 dark:text-purple-300">{pwdTotal?.total_transactions ?? 0}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">PWD Transactions</div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{(scTotal?.total_discount ?? 0).toFixed(2)}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Total SC Discount (₱)</div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <div className="text-lg font-bold text-purple-700 dark:text-purple-300">{(pwdTotal?.total_discount ?? 0).toFixed(2)}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Total PWD Discount (₱)</div>
        </div>
      </div>

      {/* Policy info */}
      <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
        <strong>Discount policy:</strong> 20% on specified goods and services for senior citizens (RA 9994) and PWD (RA 10754).
        VAT exemption applies on top of the 20% discount. These discounts are deductible as a business expense (not a tax credit).
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
          <option value="">All Types</option>
          <option value="SC">Senior Citizen</option>
          <option value="PWD">PWD</option>
        </select>
        <input type="date" value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
        <input type="date" value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              {['Date','Type','ID Number','Beneficiary','Document No.','Gross Amount','Discount (20%)','VAT Exempt','Net Amount'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No SC/PWD transactions found.</td></tr>}
            {paged.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">{t.transaction_date}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.sc_pwd_type === 'SC' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'}`}>
                    {t.sc_pwd_type}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{t.id_number}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{t.beneficiary_name}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                  {(t as unknown as Record<string, unknown>).document_no as string ?? '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">{t.gross_amount.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-700 dark:text-red-400">({t.discount_amount.toFixed(2)})</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{t.vat_exemption_amount.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">{t.net_amount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
    </div>
  );
}
