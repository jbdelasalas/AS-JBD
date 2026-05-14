'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface CompanyRow {
  id: string;
  code: string;
  name: string;
  trade_name: string | null;
  tin: string | null;
  vat_status: string | null;
  accounting_method: string;
  is_active: boolean;
}

export default function CompaniesPage() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<CompanyRow[]>('/admin/companies')
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Companies</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Company profiles and BIR registration.</p>
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Code</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">TIN</th>
              <th className="px-3 py-2 text-left font-medium">VAT</th>
              <th className="px-3 py-2 text-left font-medium">Method</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{c.code}</td>
                <td className="px-3 py-2">
                  <Link href={`/dashboard/admin/companies/${c.id}`} className="font-medium text-brand-700 dark:text-brand-400 hover:underline">
                    {c.name}
                  </Link>
                  {c.trade_name && <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">({c.trade_name})</span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{c.tin ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{c.vat_status ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{c.accounting_method}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 dark:text-slate-400'}`}>
                    {c.is_active ? 'active' : 'inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
