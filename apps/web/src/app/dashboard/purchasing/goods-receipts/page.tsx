'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface GRNRow {
  id: string; grn_no: string; receipt_date: string; delivery_no: string | null;
  po_no: string; supplier_name: string; status: string;
  branch_code: string | null; branch_name: string | null;
  building_code: string | null; building_name: string | null;
  cost_center_code: string | null; grow_ref_code: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700',
};

const COLUMNS: ColDef<GRNRow>[] = [
  { key: 'grn_no',           header: 'GRN No.',      render: r => <Link href={`/dashboard/purchasing/goods-receipts/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">{r.grn_no}</Link>, exportValue: r => r.grn_no },
  { key: 'receipt_date',     header: 'Date',          render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.receipt_date)}</span>, exportValue: r => formatDate(r.receipt_date) },
  { key: 'po_no',            header: 'PO No.',        render: r => <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{r.po_no}</span>, exportValue: r => r.po_no },
  { key: 'supplier_name',    header: 'Supplier',      render: r => <span className="text-sm text-slate-900 dark:text-slate-100">{r.supplier_name}</span>, exportValue: r => r.supplier_name },
  { key: 'branch_code',      header: 'Location',      render: r => <span className="text-xs text-slate-500">{r.branch_code ?? '—'}</span>, exportValue: r => r.branch_code ?? '' },
  { key: 'building_code',    header: 'Building',      render: r => <span className="text-xs text-slate-500">{r.building_code ?? '—'}</span>, exportValue: r => r.building_code ?? '' },
  { key: 'cost_center_code', header: 'Cost Center',   render: r => <span className="text-xs text-slate-500">{r.cost_center_code ?? '—'}</span>, exportValue: r => r.cost_center_code ?? '' },
  { key: 'grow_ref_code',    header: 'Grow Ref',      render: r => <span className="text-xs text-slate-500">{r.grow_ref_code ?? '—'}</span>, exportValue: r => r.grow_ref_code ?? '' },
  { key: 'delivery_no',      header: 'Delivery No.',  render: r => <span className="text-xs text-slate-600">{r.delivery_no ?? '—'}</span>, exportValue: r => r.delivery_no ?? '' },
  { key: 'status',           header: 'Status',        render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>{r.status}</span>, exportValue: r => r.status },
];

export default function GoodsReceiptsPage() {
  const [rows, setRows]     = useState<GRNRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [page, setPage]     = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true);
    api.get<{ data: GRNRow[] }>(`/purchasing/goods-receipts?company_id=${cid}&limit=500`)
      .then(r => setRows(r.data)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Goods Receipts</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Record goods received against approved purchase orders.</p>
        </div>
        <Link href="/dashboard/purchasing/goods-receipts/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New GRN</Link>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <DataTable id="grn-list" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="goods-receipts">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
