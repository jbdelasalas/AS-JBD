'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import ImportExportButtons from '@/components/ImportExportButtons';

interface SupplierRow {
  id: string;
  code: string;
  name: string;
  supplier_type: string;
  phone: string | null;
  email: string | null;
  payment_terms_days: number;
  open_ap_balance: number;
  is_active: boolean;
}

export default function SuppliersPage() {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [toggling, setToggling] = useState<string | null>(null);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    setPage(1);
    const q = search
      ? `/ap/suppliers?company_id=${companyId}&search=${encodeURIComponent(search)}&limit=500`
      : `/ap/suppliers?company_id=${companyId}&limit=500`;
    api.get<{ data: SupplierRow[] }>(q)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [search]);

  async function toggleActive(id: string, current: boolean) {
    setToggling(id);
    try {
      await api.patch(`/ap/suppliers/${id}`, { is_active: !current });
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, is_active: !current } : r));
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to update supplier');
    } finally {
      setToggling(null);
    }
  }

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Suppliers</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Manage vendor master records and payment terms.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportButtons
            rows={rows as unknown as Record<string, unknown>[]}
            exportColumns={[
              { key: 'code', header: 'Code' },
              { key: 'name', header: 'Name' },
              { key: 'supplier_type', header: 'Type' },
              { key: 'email', header: 'Email' },
              { key: 'phone', header: 'Phone' },
              { key: 'payment_terms_days', header: 'Payment Terms (days)' },
              { key: 'is_active', header: 'Active' },
            ]}
            importColumns={[
              { key: 'name', header: 'Name' },
              { key: 'supplier_type', header: 'Type (trade/refinery/service)' },
              { key: 'email', header: 'Email' },
              { key: 'phone', header: 'Phone' },
              { key: 'tin', header: 'TIN' },
              { key: 'address', header: 'Address' },
              { key: 'contact_person', header: 'Contact Person' },
              { key: 'payment_terms_days', header: 'Payment Terms (days)' },
            ]}
            filename="suppliers"
            onImportRow={async (row) => {
              const companyId = localStorage.getItem('company_id')!;
              await api.post('/ap/suppliers', {
                company_id: companyId,
                name: row['Name'],
                supplier_type: row['Type (trade/refinery/service)'] || 'trade',
                email: row['Email'] || undefined,
                phone: row['Phone'] || undefined,
                tin: row['TIN'] || undefined,
                address: row['Address'] || undefined,
                contact_person: row['Contact Person'] || undefined,
                payment_terms_days: parseInt(row['Payment Terms (days)']) || 30,
              });
            }}
            onImportComplete={() => {
              const companyId = localStorage.getItem('company_id');
              if (!companyId) return;
              api.get<{ data: SupplierRow[] }>(`/ap/suppliers?company_id=${companyId}&limit=500`)
                .then((r) => setRows(r.data)).catch(() => {});
            }}
          />
          <Link href="/dashboard/purchasing/suppliers/new"
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            + New supplier
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
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Code</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Terms</th>
              <th className="px-3 py-2 text-right font-medium">Open AP</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500">
                  No suppliers found.
                </td>
              </tr>
            ) : paged.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.code}</td>
                <td className="px-3 py-2">
                  <Link href={`/dashboard/purchasing/suppliers/${r.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
                    {r.name}
                  </Link>
                  {r.email && <div className="text-xs text-slate-500 dark:text-slate-400">{r.email}</div>}
                </td>
                <td className="px-3 py-2 text-xs capitalize text-slate-600 dark:text-slate-400">{r.supplier_type}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.payment_terms_days}d</td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  <span className={r.open_ap_balance > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400'}>
                    {formatPHP(r.open_ap_balance)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${r.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}>
                    {r.is_active ? 'active' : 'inactive'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    disabled={toggling === r.id}
                    onClick={() => toggleActive(r.id, r.is_active)}
                    className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                      r.is_active
                        ? 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950'
                        : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950'
                    }`}
                  >
                    {toggling === r.id ? '…' : r.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </div>
  );
}
