'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface SOHRow {
  item_id: string;
  sku: string;
  name: string;
  uom: string;
  reorder_point: number;
  warehouse_id: string;
  warehouse_name: string;
  qty_on_hand: number;
  avg_cost: number;
  stock_value: number;
  last_movement_at: string | null;
}

const COLUMNS: ColDef<SOHRow>[] = [
  { key: 'sku',           header: 'SKU',         render: r => <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{r.sku}</span>, exportValue: r => r.sku },
  { key: 'name',          header: 'Name',        render: r => <span className="text-slate-900 dark:text-slate-100">{r.name}</span>, exportValue: r => r.name },
  { key: 'warehouse_name',header: 'Warehouse',   render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.warehouse_name}</span>, exportValue: r => r.warehouse_name },
  { key: 'qty_on_hand',   header: 'Qty',         align: 'right', render: r => { const isLow = r.qty_on_hand <= r.reorder_point && r.reorder_point > 0; return <span className={`font-mono text-xs font-medium ${isLow ? 'text-red-600' : 'text-slate-900 dark:text-slate-100'}`}>{r.qty_on_hand.toLocaleString()}</span>; }, exportValue: r => String(r.qty_on_hand) },
  { key: 'uom',           header: 'UOM',         render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.uom}</span>, exportValue: r => r.uom },
  { key: 'avg_cost',      header: 'Avg Cost',    align: 'right', render: r => <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{formatPHP(r.avg_cost)}</span>, exportValue: r => String(r.avg_cost) },
  { key: 'stock_value',   header: 'Stock Value', align: 'right', render: r => <span className="font-mono text-xs font-medium text-slate-900 dark:text-slate-100">{formatPHP(r.stock_value)}</span>, exportValue: r => String(r.stock_value) },
  { key: 'status',        header: 'Status',      render: r => { const isLow = r.qty_on_hand <= r.reorder_point && r.reorder_point > 0; return isLow ? <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">low stock</span> : <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">ok</span>; }, exportValue: r => r.qty_on_hand <= r.reorder_point && r.reorder_point > 0 ? 'low stock' : 'ok' },
];

export default function StockOnHandPage() {
  const [rows, setRows] = useState<SOHRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    setPage(1);
    const params = new URLSearchParams({ company_id: companyId, hide_zero: 'true' });
    if (search) params.set('search', search);
    if (lowStockOnly) params.set('low_stock', 'true');
    api.get<SOHRow[]>(`/inventory/stock-on-hand?${params}`)
      .then((r) => setRows(r))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [search, lowStockOnly]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalValue = rows.reduce((s, r) => s + r.stock_value, 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stock On Hand</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {rows.length} rows · Total value: <span className="font-medium text-slate-900 dark:text-slate-100">{formatPHP(totalValue)}</span>
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <input
          type="search"
          placeholder="Search SKU or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
          Low stock only
        </label>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <DataTable
        id="inventory-soh"
        columns={COLUMNS}
        rows={paged}
        exportRows={rows}
        loading={loading}
        filename="stock-on-hand"
        emptyMessage="No stock data found."
      >
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
