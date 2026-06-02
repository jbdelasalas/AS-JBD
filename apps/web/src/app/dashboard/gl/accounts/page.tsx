'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Account, AccountTypeCode } from '@perpet/shared';
import Link from 'next/link';
import { Pagination } from '@/components/Pagination';
import ImportExportButtons from '@/components/ImportExportButtons';
import DataTable, { ColDef } from '@/components/DataTable';

const TYPES: AccountTypeCode[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

const COLUMNS: ColDef<Account>[] = [
  { key: 'code',         header: 'Code',     render: r => <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{r.code}</span>, exportValue: r => r.code },
  { key: 'name',         header: 'Name',     render: r => <Link href={`/dashboard/gl/accounts/${r.id}`} className="text-brand-700 hover:underline dark:text-brand-400">{r.name}</Link>, exportValue: r => r.name },
  { key: 'account_type', header: 'Type',     render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.account_type}</span>, exportValue: r => r.account_type },
  { key: 'currency',     header: 'Currency', render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.currency}</span>, exportValue: r => r.currency },
  { key: 'is_control',   header: 'Control',  render: r => r.is_control ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">control</span> : <span className="text-slate-400 text-xs">—</span>, exportValue: r => r.is_control ? 'yes' : '' },
];

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState<AccountTypeCode | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

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

  useEffect(() => { setPage(1); }, [filter, search]);

  const filtered = accounts.filter((a) => {
    if (filter !== 'ALL' && a.account_type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!a.code.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Chart of accounts</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{accounts.length} accounts loaded</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportButtons
            showExport={false}
            rows={accounts as unknown as Record<string, unknown>[]}
            exportColumns={[
              { key: 'code', header: 'Code' },
              { key: 'name', header: 'Name' },
              { key: 'account_type', header: 'Type' },
              { key: 'currency', header: 'Currency' },
              { key: 'is_control', header: 'Control' },
              { key: 'description', header: 'Description' },
            ]}
            importColumns={[
              { key: 'code', header: 'Code' },
              { key: 'name', header: 'Name' },
              { key: 'account_type', header: 'Type (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE)' },
              { key: 'currency', header: 'Currency' },
              { key: 'description', header: 'Description' },
            ]}
            filename="chart-of-accounts"
            onImportRow={async (row) => {
              const companyId = localStorage.getItem('company_id')!;
              await api.post('/gl/accounts', {
                company_id: companyId,
                code: row['Code'],
                name: row['Name'],
                account_type: row['Type (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE)'] || 'ASSET',
                currency: row['Currency'] || 'PHP',
                description: row['Description'] || undefined,
              });
            }}
            onImportComplete={() => {
              const companyId = localStorage.getItem('company_id');
              if (!companyId) return;
              api.get<Account[]>(`/gl/accounts?company_id=${companyId}&active_only=true`)
                .then(setAccounts).catch(() => {});
            }}
          />
          <Link href="/dashboard/gl/accounts/new"
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            + New account
          </Link>
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
          className="rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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

      <DataTable id="gl-accounts" columns={COLUMNS} rows={paged} exportRows={filtered} loading={loading} filename="chart-of-accounts"
        emptyMessage="No accounts match the filters.">
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
