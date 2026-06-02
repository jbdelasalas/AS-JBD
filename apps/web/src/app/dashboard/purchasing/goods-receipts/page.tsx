'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';

interface GRNRow {
  id: string;
  grn_no: string;
  receipt_date: string;
  delivery_no: string | null;
  po_no: string;
  supplier_name: string;
  status: string;
  branch_code: string | null;   branch_name: string | null;
  building_code: string | null; building_name: string | null;
  cost_center_code: string | null;
  grow_ref_code: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  posted: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

export default function GoodsReceiptsPage() {
  const [rows, setRows] = useState<GRNRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: GRNRow[] }>(`/purchasing/goods-receipts?company_id=${companyId}&limit=500`)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Goods Receipts</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Record goods received against approved purchase orders.</p>
        </div>
        <Link href="/dashboard/purchasing/goods-receipts/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          + New GRN
        </Link>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">GRN No.</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">PO No.</th>
              <th className="px-3 py-2 text-left font-medium">Supplier</th>
              <th className="px-3 py-2 text-left font-medium">Location</th>
              <th className="px-3 py-2 text-left font-medium">Building</th>
              <th className="px-3 py-2 text-left font-medium">Cost Center</th>
              <th className="px-3 py-2 text-left font-medium">Grow</th>
              <th className="px-3 py-2 text-left font-medium">Delivery No.</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-500">No goods receipts found.</td></tr>
            ) : paged.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/purchasing/goods-receipts/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">
                    {r.grn_no}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(r.receipt_date)}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.po_no}</td>
                <td className="px-3 py-2 text-sm text-slate-900 dark:text-slate-100">{r.supplier_name}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.branch_code ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.building_code ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.cost_center_code ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.grow_ref_code ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.delivery_no ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>
                    {r.status}
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
