'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import ImportExportButtons from '@/components/ImportExportButtons';
import DataTable, { ColDef } from '@/components/DataTable';

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
  service: 'bg-violet-100 text-violet-700',
  bundle:  'bg-amber-100 text-amber-700',
};

const COLUMNS: ColDef<ItemRow>[] = [
  { key: 'sku',           header: 'SKU',          render: r => <Link href={`/dashboard/inventory/items/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">{r.sku}</Link>, exportValue: r => r.sku },
  { key: 'name',          header: 'Name',         render: r => <span className="font-medium text-slate-900 dark:text-slate-100">{r.name}</span>, exportValue: r => r.name },
  { key: 'category_name', header: 'Category',     render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.category_name ?? '—'}</span>, exportValue: r => r.category_name ?? '' },
  { key: 'uom',           header: 'UOM',          render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.uom}</span>, exportValue: r => r.uom },
  { key: 'item_type',     header: 'Type',         render: r => <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${TYPE_COLORS[r.item_type] ?? 'bg-slate-100 text-slate-700'}`}>{r.item_type}</span>, exportValue: r => r.item_type },
  { key: 'standard_cost', header: 'Std Cost',     align: 'right', render: r => <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{formatPHP(r.standard_cost)}</span>, exportValue: r => String(r.standard_cost) },
  { key: 'selling_price', header: 'Selling Price',align: 'right', render: r => <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{formatPHP(r.selling_price)}</span>, exportValue: r => String(r.selling_price) },
  { key: 'reorder_point', header: 'Reorder Pt',  align: 'right', render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.reorder_point}</span>, exportValue: r => String(r.reorder_point) },
  { key: 'is_active',     header: 'Status',       render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{r.is_active ? 'active' : 'inactive'}</span>, exportValue: r => r.is_active ? 'active' : 'inactive' },
];

export default function ItemsPage() {
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
      .then((r) => setRows(r))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [search]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Items</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">SKUs, pricing, and costing configuration.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportButtons
            showExport={false}
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
                .then(setRows).catch(() => {});
            }}
          />
          <Link href="/dashboard/inventory/items/new"
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            + New item
          </Link>
        </div>
      </div>

      <div className="mb-3">
        <input
          type="search"
          placeholder="Search by SKU or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <DataTable id="inventory-items" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="items">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
