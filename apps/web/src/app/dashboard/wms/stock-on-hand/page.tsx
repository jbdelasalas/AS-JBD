'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import DataTable, { ColDef } from '@/components/DataTable';

interface Warehouse { id: string; name: string; }
interface SohRow {
  id: string; sku: string; item_name: string; uom: string;
  warehouse_name: string; bin_code: string; zone: string | null; bin_type: string;
  lot_no: string | null; expiry_date: string | null;
  qty_on_hand: number; avg_cost: number; stock_value: number; last_movement_at: string | null;
}

const COLUMNS: ColDef<SohRow>[] = [
  { key: 'sku',            header: 'SKU',     render: r => <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{r.sku}</span>, exportValue: r => r.sku },
  { key: 'item_name',      header: 'Item',    render: r => <span className="text-xs text-slate-700 dark:text-slate-300">{r.item_name}</span>, exportValue: r => r.item_name },
  { key: 'warehouse_name', header: 'Warehouse', render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.warehouse_name}</span>, exportValue: r => r.warehouse_name },
  { key: 'bin_code',       header: 'Bin',     render: r => <span className="font-mono text-xs text-brand-700 dark:text-brand-400">{r.bin_code}</span>, exportValue: r => r.bin_code },
  { key: 'lot_no',         header: 'Lot',     render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.lot_no ?? '—'}{r.expiry_date ? ` (exp ${formatDate(r.expiry_date)})` : ''}</span>, exportValue: r => r.lot_no ?? '' },
  { key: 'qty_on_hand',    header: 'Qty',     render: r => <span className="text-xs tabular-nums text-slate-900 dark:text-slate-100">{r.qty_on_hand.toLocaleString()} {r.uom}</span>, exportValue: r => String(r.qty_on_hand) },
  { key: 'stock_value',    header: 'Value',   render: r => <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300">{r.stock_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>, exportValue: r => String(r.stock_value) },
];

export default function BinStockPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [hideZero, setHideZero] = useState(true);
  const [rows, setRows] = useState<SohRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: Warehouse[] }>(`/wms/warehouses?company_id=${companyId}`).then((r) => setWarehouses(r.data)).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    const qs = new URLSearchParams({ company_id: companyId });
    if (warehouseId) qs.set('warehouse_id', warehouseId);
    if (search) qs.set('search', search);
    if (hideZero) qs.set('hide_zero', 'true');
    api.get<SohRow[]>(`/wms/stock-on-hand?${qs.toString()}`)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId, warehouseId, search, hideZero]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Bin Stock On Hand</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Quantities by warehouse, bin, and lot.</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU or name…"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> Hide zero qty
        </label>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <DataTable id="wms-bin-soh" columns={COLUMNS} rows={rows} exportRows={rows} loading={loading} filename="bin-stock-on-hand"
        emptyMessage="No bin stock. Put away received goods to populate bins." />
    </div>
  );
}
