'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Account, AccountTypeCode } from '@perpet/shared';

const TYPES: AccountTypeCode[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState<AccountTypeCode | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    api
      .get<Account[]>(`/gl/accounts?company_id=${companyId}&active_only=true`)
      .then((data) => setAccounts(data))
      .catch((e) => setError(e.message ?? 'Failed to load accounts'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = accounts.filter((a) => {
    if (filter !== 'ALL' && a.account_type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!a.code.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Chart of accounts</h1>
          <p className="text-sm text-slate-600">{accounts.length} accounts loaded</p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search code or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as AccountTypeCode | 'ALL')}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="ALL">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Code</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Currency</th>
              <th className="px-3 py-2 text-left font-medium">Control</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">No accounts match the filters.</td></tr>
            ) : (
              filtered.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{a.code}</td>
                  <td className="px-3 py-2 text-slate-900">{a.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{a.account_type}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{a.currency}</td>
                  <td className="px-3 py-2 text-xs">
                    {a.is_control ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">control</span> : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
