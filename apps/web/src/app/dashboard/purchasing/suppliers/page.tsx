'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import ImportExportButtons from '@/components/ImportExportButtons';
import DataTable, { ColDef } from '@/components/DataTable';

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
  const [deleting, setDeleting] = useState<string | null>(null);
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

  async function remove(row: SupplierRow) {
    if (!confirm(`Delete supplier "${row.name}"? This cannot be undone.`)) return;
    setError(null);
    setDeleting(row.id);
    try {
      await api.delete(`/ap/suppliers/${row.id}`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to delete supplier');
    } finally {
      setDeleting(null);
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

      {(() => {
        const COLS: ColDef<SupplierRow>[] = [
          { key: 'code',               header: 'Code',    render: r => <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{r.code}</span>, exportValue: r => r.code },
          { key: 'name',               header: 'Name',    render: r => <><Link href={`/dashboard/purchasing/suppliers/${r.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">{r.name}</Link>{r.email && <div className="text-xs text-slate-500">{r.email}</div>}</>, exportValue: r => r.name },
          { key: 'supplier_type',      header: 'Type',    render: r => <span className="text-xs capitalize text-slate-600 dark:text-slate-400">{r.supplier_type}</span>, exportValue: r => r.supplier_type },
          { key: 'payment_terms_days', header: 'Terms',   render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.payment_terms_days}d</span>, exportValue: r => `${r.payment_terms_days}d` },
          { key: 'open_ap_balance',    header: 'Open AP', align: 'right', render: r => <span className={`font-mono text-xs ${r.open_ap_balance > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400'}`}>{formatPHP(r.open_ap_balance)}</span>, exportValue: r => String(r.open_ap_balance) },
          { key: 'is_active',          header: 'Status',  render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{r.is_active ? 'active' : 'inactive'}</span>, exportValue: r => r.is_active ? 'active' : 'inactive' },
          { key: 'action',             header: '',        render: r => <div className="flex justify-end gap-2"><button disabled={toggling === r.id} onClick={() => toggleActive(r.id, r.is_active)} className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${r.is_active ? 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400'}`}>{toggling === r.id ? '…' : r.is_active ? 'Deactivate' : 'Activate'}</button><button disabled={deleting === r.id} onClick={() => remove(r)} className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{deleting === r.id ? '…' : 'Delete'}</button></div> },
        ];
        return (
          <DataTable id="ap-suppliers" columns={COLS} rows={paged} exportRows={rows} loading={loading} filename="suppliers" showExport={false}>
            <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </DataTable>
        );
      })()}
    </div>
  );
}
