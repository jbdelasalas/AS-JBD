'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import ImportExportButtons from '@/components/ImportExportButtons';
import DataTable, { ColDef } from '@/components/DataTable';

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  customer_type: string;
  phone: string | null;
  email: string | null;
  credit_limit: number;
  open_ar_balance: number;
  payment_terms_days: number;
  is_active: boolean;
}

export default function CustomersPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    setPage(1);
    const q = search
      ? `/ar/customers?company_id=${companyId}&search=${encodeURIComponent(search)}&limit=500`
      : `/ar/customers?company_id=${companyId}&limit=500`;
    api.get<{ data: CustomerRow[] }>(q)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [search]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Customers</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Manage customer master records and credit limits.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportButtons
            rows={rows as unknown as Record<string, unknown>[]}
            exportColumns={[
              { key: 'code', header: 'Code' },
              { key: 'name', header: 'Name' },
              { key: 'customer_type', header: 'Type' },
              { key: 'email', header: 'Email' },
              { key: 'phone', header: 'Phone' },
              { key: 'payment_terms_days', header: 'Payment Terms (days)' },
              { key: 'credit_limit', header: 'Credit Limit' },
              { key: 'is_active', header: 'Active' },
            ]}
            importColumns={[
              { key: 'name', header: 'Name' },
              { key: 'customer_type', header: 'Type (HRI/Wet/Others)' },
              { key: 'email', header: 'Email' },
              { key: 'phone', header: 'Phone' },
              { key: 'tin', header: 'TIN' },
              { key: 'address', header: 'Address' },
              { key: 'contact_person', header: 'Contact Person' },
              { key: 'payment_terms_days', header: 'Payment Terms (days)' },
              { key: 'credit_limit', header: 'Credit Limit' },
            ]}
            filename="customers"
            onImportRow={async (row) => {
              const companyId = localStorage.getItem('company_id')!;
              await api.post('/ar/customers', {
                company_id: companyId,
                name: row['Name'],
                customer_type: row['Type (HRI/Wet/Others)'] || 'HRI',
                email: row['Email'] || undefined,
                phone: row['Phone'] || undefined,
                tin: row['TIN'] || undefined,
                address: row['Address'] || undefined,
                contact_person: row['Contact Person'] || undefined,
                payment_terms_days: parseInt(row['Payment Terms (days)']) || 30,
                credit_limit: parseFloat(row['Credit Limit']) || 0,
              });
            }}
            onImportComplete={() => {
              const companyId = localStorage.getItem('company_id');
              if (!companyId) return;
              api.get<{ data: CustomerRow[] }>(`/ar/customers?company_id=${companyId}&limit=500`)
                .then((r) => setRows(r.data)).catch(() => {});
            }}
          />
          <Link href="/dashboard/ar/customers/new"
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            + New customer
          </Link>
        </div>
      </div>

      <div className="mb-3">
        <input
          type="search"
          placeholder="Search by name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {(() => {
        const COLS: ColDef<CustomerRow>[] = [
          { key: 'code',               header: 'Code',         render: r => <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{r.code}</span>, exportValue: r => r.code },
          { key: 'name',               header: 'Name',         render: r => <><Link href={`/dashboard/ar/customers/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.name}</Link>{r.email && <div className="text-xs text-slate-500">{r.email}</div>}</>, exportValue: r => r.name },
          { key: 'customer_type',      header: 'Type',         render: r => <span className="text-xs capitalize text-slate-600 dark:text-slate-400">{r.customer_type}</span>, exportValue: r => r.customer_type },
          { key: 'payment_terms_days', header: 'Terms',        render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.payment_terms_days}d</span>, exportValue: r => `${r.payment_terms_days}d` },
          { key: 'credit_limit',       header: 'Credit Limit', align: 'right', render: r => <span className="font-mono text-xs">{r.credit_limit > 0 ? formatPHP(r.credit_limit) : '—'}</span>, exportValue: r => String(r.credit_limit) },
          { key: 'open_ar_balance',    header: 'Open AR',      align: 'right', render: r => <span className={`font-mono text-xs ${r.open_ar_balance > 0 ? 'text-amber-700 font-medium' : 'text-slate-600 dark:text-slate-400'}`}>{formatPHP(r.open_ar_balance)}</span>, exportValue: r => String(r.open_ar_balance) },
          { key: 'is_active',          header: 'Status',       render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{r.is_active ? 'active' : 'inactive'}</span>, exportValue: r => r.is_active ? 'active' : 'inactive' },
        ];
        return (
          <DataTable id="ar-customers" columns={COLS} rows={paged} exportRows={rows} loading={loading} filename="customers" showExport={false}>
            <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </DataTable>
        );
      })()}
    </div>
  );
}
