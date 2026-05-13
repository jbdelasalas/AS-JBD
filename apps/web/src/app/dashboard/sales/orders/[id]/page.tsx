'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { SalesOrder } from '@perpet/shared';

const STATUS_STYLES: Record<string, string> = {
  draft:                'bg-slate-100 text-slate-700 dark:text-slate-300',
  pending_approval:     'bg-amber-100 text-amber-700',
  approved:             'bg-blue-100 text-blue-700',
  partially_delivered:  'bg-orange-100 text-orange-700',
  fully_delivered:      'bg-emerald-100 text-emerald-700',
  closed:               'bg-purple-100 text-purple-700',
  cancelled:            'bg-red-100 text-red-700',
};

export default function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [approveNotes, setApproveNotes] = useState('');
  const [showApprove, setShowApprove] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<SalesOrder>(`/sales/orders/${id}`)
      .then(setOrder)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function action(path: string, body?: object) {
    setBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/sales/orders/${id}/${path}`, body ?? {});
      load();
    } catch (e: unknown) {
      setActionMsg((e as Error).message ?? 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  if (!order) return <div className="py-10 text-center text-sm text-red-600">{error ?? 'Not found'}</div>;

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{order.order_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[order.status] ?? STATUS_STYLES.draft}`}>
              {order.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{order.customer_name}</p>
        </div>
        <div className="flex gap-2">
          {order.status === 'draft' && (
            <button onClick={() => action('submit')} disabled={busy}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700 disabled:opacity-50">
              Submit for Approval
            </button>
          )}
          {order.status === 'pending_approval' && (
            <>
              <button onClick={() => setShowApprove(true)} disabled={busy}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
                Approve
              </button>
            </>
          )}
          {['approved','partially_delivered'].includes(order.status) && (
            <>
              <Link
                href={`/dashboard/ar/invoices/new?so_id=${order.id}`}
                className="rounded border border-brand-600 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50"
              >
                Create Invoice
              </Link>
              <button onClick={() => action('close')} disabled={busy}
                className="rounded bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-700 disabled:opacity-50">
                Close
              </button>
            </>
          )}
          {!['fully_delivered','closed','cancelled'].includes(order.status) && (
            <button onClick={() => setShowCancel(true)} disabled={busy}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
              Cancel
            </button>
          )}
        </div>
      </div>

      {actionMsg && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionMsg}</div>
      )}

      {/* Info grid */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: 'Order Date', value: formatDate(order.order_date) },
          { label: 'Delivery Date', value: order.delivery_date ? formatDate(order.delivery_date) : '—' },
          { label: 'Payment Terms', value: `${order.payment_terms_days} days` },
          { label: 'Credit Checked', value: order.credit_checked ? '✓ Passed' : 'Not yet' },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">{f.label}</div>
            <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{f.value}</div>
          </div>
        ))}
      </div>

      {/* Lines table */}
      <div className="mb-5 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white">
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300">Line Items</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Delivered</th>
              <th className="px-3 py-2 text-right font-medium">Unit Price</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.lines?.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{l.item_sku}</td>
                <td className="px-3 py-2">{l.description}</td>
                <td className="px-3 py-2 text-right font-mono">{l.quantity}</td>
                <td className="px-3 py-2 text-right font-mono">
                  <span className={l.qty_delivered >= l.quantity ? 'text-emerald-600' : 'text-slate-600 dark:text-slate-400'}>
                    {l.qty_delivered}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatPHP(l.unit_price)}</td>
                <td className="px-3 py-2 text-right font-mono font-medium">{formatPHP(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <td colSpan={5} className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-400">Subtotal</td>
              <td colSpan={2} className="px-3 py-2 text-right font-mono">{formatPHP(order.subtotal)}</td>
            </tr>
            <tr className="bg-slate-50 dark:bg-slate-800">
              <td colSpan={5} className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-400">VAT (12%)</td>
              <td colSpan={2} className="px-3 py-2 text-right font-mono">{formatPHP(order.vat_amount)}</td>
            </tr>
            <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <td colSpan={5} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total</td>
              <td colSpan={2} className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(order.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Approve modal */}
      {showApprove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Approve Sales Order</h2>
            <textarea
              rows={3}
              placeholder="Approval notes (optional)…"
              value={approveNotes}
              onChange={(e) => setApproveNotes(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowApprove(false); action('approve', { notes: approveNotes }); }}
                className="flex-1 rounded bg-emerald-600 py-2 text-sm text-white hover:bg-emerald-700"
              >
                Confirm Approval
              </button>
              <button onClick={() => setShowApprove(false)} className="flex-1 rounded border border-slate-300 py-2 text-sm text-slate-700 dark:text-slate-300">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel modal */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Cancel Sales Order</h2>
            <textarea
              rows={3}
              placeholder="Reason for cancellation (required)…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="flex gap-2">
              <button
                disabled={!cancelReason.trim()}
                onClick={() => { setShowCancel(false); action('cancel', { reason: cancelReason }); }}
                className="flex-1 rounded bg-red-600 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-40"
              >
                Confirm Cancel
              </button>
              <button onClick={() => setShowCancel(false)} className="flex-1 rounded border border-slate-300 py-2 text-sm text-slate-700 dark:text-slate-300">
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
