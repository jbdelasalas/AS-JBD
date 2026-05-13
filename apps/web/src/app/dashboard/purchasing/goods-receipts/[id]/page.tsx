'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface GRNLine {
  id: string;
  line_no: number;
  description: string;
  po_qty: number;
  qty_received: number;
  unit_cost: number;
  unit_price: number;
  item_sku: string | null;
  item_name: string | null;
}

interface GRN {
  id: string;
  grn_no: string;
  receipt_date: string;
  delivery_no: string | null;
  notes: string | null;
  status: string;
  po_no: string;
  po_id: string;
  supplier_name: string;
  supplier_code: string;
  lines: GRNLine[];
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  posted: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

export default function GRNDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [grn, setGrn] = useState<GRN | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<GRN>(`/purchasing/goods-receipts/${id}`).then(setGrn).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!grn) return <div className="py-10 text-center text-sm text-red-600">Goods receipt not found</div>;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{grn.grn_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[grn.status] ?? STATUS_STYLES.draft}`}>
              {grn.status}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{grn.supplier_name}</p>
        </div>
        <Link href={`/dashboard/purchasing/purchase-orders/${grn.po_id}`}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
          View PO: {grn.po_no}
        </Link>
      </div>

      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: 'Receipt Date', value: formatDate(grn.receipt_date) },
          { label: 'PO no.', value: grn.po_no },
          { label: 'Delivery Note', value: grn.delivery_no ?? '—' },
          { label: 'Notes', value: grn.notes ?? '—' },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">{f.label}</div>
            <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{f.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">Lines Received</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">PO Qty</th>
              <th className="px-3 py-2 text-right font-medium">Qty Received</th>
              <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
            </tr>
          </thead>
          <tbody>
            {grn.lines?.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 dark:text-slate-300">
                  {l.description}
                  {l.item_sku && <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">({l.item_sku})</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs dark:text-slate-300">{l.po_qty}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">{l.qty_received}</td>
                <td className="px-3 py-2 text-right font-mono text-xs dark:text-slate-300">
                  {l.unit_cost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
