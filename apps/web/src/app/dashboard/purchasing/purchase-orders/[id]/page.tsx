'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface POLine {
  id: string;
  line_no: number;
  description: string;
  quantity: number;
  qty_received: number;
  unit_price: number;
  vat_rate: number;
  line_total: number;
  item_sku: string | null;
  item_name: string | null;
}

interface PO {
  id: string;
  po_no: string;
  po_date: string;
  expected_date: string | null;
  reference: string | null;
  supplier_name: string;
  supplier_code: string;
  supplier_id: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  status: string;
  lines: POLine[];
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  partial: 'bg-orange-100 text-orange-700',
  received: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function PODetailPage() {
  const { id } = useParams<{ id: string }>();
  const [po, setPo] = useState<PO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<PO>(`/purchasing/purchase-orders/${id}`).then(setPo).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function doAction(action: string) {
    setBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/purchasing/purchase-orders/${id}/${action}`);
      load();
    } catch (e: unknown) {
      setActionMsg((e as Error).message ?? 'Action failed');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!po) return <div className="py-10 text-center text-sm text-red-600">Purchase order not found</div>;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{po.po_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[po.status] ?? STATUS_STYLES.draft}`}>
              {po.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            <Link href={`/dashboard/purchasing/suppliers/${po.supplier_id}`} className="hover:underline">
              {po.supplier_name}
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          {po.status === 'draft' && (
            <button onClick={() => doAction('submit')} disabled={busy}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700 disabled:opacity-50">
              Submit for Approval
            </button>
          )}
          {po.status === 'pending_approval' && (
            <button onClick={() => doAction('approve')} disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
              Approve
            </button>
          )}
          {po.status === 'approved' && (
            <Link href={`/dashboard/purchasing/goods-receipts/new?po_id=${id}`}
              className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">
              Receive Goods
            </Link>
          )}
          {!['received','closed','cancelled'].includes(po.status) && (
            <button onClick={() => doAction('cancel')} disabled={busy}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400">
              Cancel
            </button>
          )}
        </div>
      </div>

      {actionMsg && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{actionMsg}</div>
      )}

      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: 'PO Date', value: formatDate(po.po_date) },
          { label: 'Expected Date', value: po.expected_date ? formatDate(po.expected_date) : '—' },
          { label: 'Reference', value: po.reference ?? '—' },
          { label: 'Supplier Code', value: po.supplier_code },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">{f.label}</div>
            <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{f.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">PO Lines</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Received</th>
              <th className="px-3 py-2 text-right font-medium">Unit Price</th>
              <th className="px-3 py-2 text-right font-medium">VAT %</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {po.lines?.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 dark:text-slate-300">
                  {l.description}
                  {l.item_sku && <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">({l.item_sku})</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs dark:text-slate-300">{l.quantity}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  <span className={l.qty_received >= l.quantity ? 'text-emerald-600' : l.qty_received > 0 ? 'text-amber-600' : 'text-slate-500'}>
                    {l.qty_received}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs dark:text-slate-300">{formatPHP(l.unit_price)}</td>
                <td className="px-3 py-2 text-right text-xs dark:text-slate-300">{l.vat_rate}%</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold dark:text-slate-300">{formatPHP(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {[
              { label: 'Subtotal', value: po.subtotal },
              { label: 'VAT', value: po.vat_amount },
            ].map((row) => (
              <tr key={row.label} className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={6} className="px-3 py-1.5 text-right text-xs text-slate-600 dark:text-slate-400">{row.label}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs dark:text-slate-300">{formatPHP(row.value)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <td colSpan={6} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total</td>
              <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(po.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
