'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import ImportExportButtons from '@/components/ImportExportButtons';

interface ItemRow {
  id: string;
  sku: string;
  name: string;
  uom: string;
  item_type: string;
  costing_method: string;
  standard_cost: number;
  selling_price: number;
  reorder_point: number;
  is_active: boolean;
  category_name: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  stock:   'bg-blue-100 text-blue-700',
  product: 'bg-blue-100 text-blue-700',
  service: 'bg-violet-100 text-violet-700',
  bundle:  'bg-amber-100 text-amber-700',
};

export default function MasterDataItemsPage() {
  const [rows, setRows] = useState<ItemRow[]>([]);
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
    const q = `/inventory/items?company_id=${companyId}&limit=500${search ? `&search=${encodeURIComponent(search)}` : ''}`;
    api.get<ItemRow[]>(q)
      .then(r => setRows(Array.isArray(r) ? r : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [search]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <Link href="/dashboard/admin/master-data" className="hover:text-brand-600">Master Data</Link>
            <span>/</span>
            <span>Items</span>
          </div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Items</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">SKUs, pricing, costing, and item catalog.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportButtons
            rows={rows as unknown as Record<string, unknown>[]}
            exportColumns={[
              { key: 'sku', header: 'SKU' },
              { key: 'name', header: 'Name' },
              { key: 'category_name', header: 'Category' },
              { key: 'uom', header: 'UOM' },
              { key: 'item_type', header: 'Type' },
              { key: 'costing_method', header: 'Costing Method' },
              { key: 'standard_cost', header: 'Standard Cost' },
              { key: 'selling_price', header: 'Selling Price' },
              { key: 'reorder_point', header: 'Reorder Point' },
              { key: 'is_active', header: 'Active' },
            ]}
            importColumns={[
              { key: 'sku', header: 'SKU' },
              { key: 'name', header: 'Name' },
              { key: 'uom', header: 'UOM (e.g. PCS, L, KG)' },
              { key: 'item_type', header: 'Type (stock/service/bundle)' },
              { key: 'costing_method', header: 'Costing Method (weighted_avg/fifo/standard)' },
              { key: 'standard_cost', header: 'Standard Cost' },
              { key: 'selling_price', header: 'Selling Price' },
              { key: 'reorder_point', header: 'Reorder Point' },
            ]}
            filename="items"
            onImportRow={async (row) => {
              const companyId = localStorage.getItem('company_id')!;
              await api.post('/inventory/items', {
                company_id: companyId,
                sku: row['SKU'],
                name: row['Name'],
                uom: row['UOM (e.g. PCS, L, KG)'] || 'PCS',
                item_type: row['Type (stock/service/bundle)'] || 'stock',
                costing_method: row['Costing Method (weighted_avg/fifo/standard)'] || 'weighted_avg',
                standard_cost: parseFloat(row['Standard Cost']) || 0,
                selling_price: parseFloat(row['Selling Price']) || 0,
                reorder_point: parseFloat(row['Reorder Point']) || 0,
              });
            }}
            onImportComplete={() => {
              const companyId = localStorage.getItem('company_id');
              if (!companyId) return;
              api.get<ItemRow[]>(`/inventory/items?company_id=${companyId}&limit=500`)
                .then(r => setRows(Array.isArray(r) ? r : [])).catch(() => {});
            }}
          />
          <Link href="/dashboard/inventory/items/new"
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            + New item
          </Link>
        </div>
      </div>

      <div className="mb-3">
        <input type="search" placeholder="Search by SKU or name…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">SKU</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Category</th>
              <th className="px-3 py-2 text-left font-medium">UOM</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Std Cost</th>
              <th className="px-3 py-2 text-right font-medium">Selling Price</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-slate-500">No items found.</td></tr>
            ) : paged.map(r => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.sku}</td>
                <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                  <Link href={`/dashboard/inventory/items/${r.id}`} className="text-brand-700 hover:underline dark:text-brand-400">{r.name}</Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.category_name ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.uom}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${TYPE_COLORS[r.item_type] ?? 'bg-slate-100 text-slate-700'}`}>
                    {r.item_type}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-700 dark:text-slate-300">{formatPHP(r.standard_cost)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-700 dark:text-slate-300">{formatPHP(r.selling_price)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {r.is_active ? 'active' : 'inactive'}
                  </span>
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
