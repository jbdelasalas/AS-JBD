'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { SalesOrder } from '@perpet/shared';

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft:               'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending_approval:    'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  approved:            'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  partially_delivered: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  fully_delivered:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  closed:              'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  cancelled:           'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

const INV_STATUS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600', open: 'bg-blue-100 text-blue-700',
  partially_paid: 'bg-amber-100 text-amber-700', paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700', cancelled: 'bg-slate-100 text-slate-500',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100">{value || <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

export default function SalesOrderDetailPage() {
  const { id }    = useParams<{ id: string }>();
  const router    = useRouter();
  const [order, setOrder]       = useState<SalesOrder | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [actionMsg, setActionMsg]     = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel]   = useState(false);
  const [approveNotes, setApproveNotes] = useState('');
  const [showApprove, setShowApprove] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') ?? '' : '';

  useEffect(() => {
    try { const u = JSON.parse(localStorage.getItem('user') ?? 'null'); setIsAdmin(u?.is_superadmin === true); } catch {}
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<SalesOrder>(`/sales/orders/${id}`),
      api.get<{ data: InvoiceRow[] }>(`/ar/invoices?company_id=${companyId}&so_id=${id}`),
    ]).then(([o, inv]) => { setOrder(o); setInvoices(inv.data); })
      .finally(() => setLoading(false));
  }, [id, companyId]);

  useEffect(() => { load(); }, [load]);

  async function doAction(path: string, body?: object) {
    setBusy(true); setActionMsg(null);
    try { await api.post(`/sales/orders/${id}/${path}`, body ?? {}); load(); }
    catch (e: unknown) { setActionMsg((e as Error).message ?? 'Action failed'); }
    finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this sales order? This cannot be undone.')) return;
    setBusy(true); setActionMsg(null);
    try { await api.delete(`/sales/orders/${id}`); router.push('/dashboard/sales/orders'); }
    catch (e: unknown) { setActionMsg((e as Error).message ?? 'Delete failed'); setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!order)  return <div className="py-10 text-center text-sm text-red-600">Sales order not found</div>;

  const isTerminal = ['fully_delivered','closed','cancelled'].includes(order.status);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{order.order_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[order.status] ?? STATUS_STYLES.draft}`}>
              {order.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{order.customer_name}</p>
        </div>
        <Link href="/dashboard/sales/orders"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          ← Back to list
        </Link>
      </div>

      {actionMsg && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {actionMsg}
        </div>
      )}

      {/* Order Details card */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Order Details</div>
        <div className="grid grid-cols-4 gap-x-6 gap-y-4">
          <div className="col-span-2">
            <Field label="Customer" value={order.customer_name ?? null} />
          </div>
          <Field label="Order Date"     value={formatDate(order.order_date)} />
          <Field label="Delivery Date"  value={order.delivery_date ? formatDate(order.delivery_date) : null} />
          <Field label="Payment Terms"  value={`${order.payment_terms_days} days`} />
          <div className="col-span-3">
            <Field label="Customer Address" value={(order as unknown as { customer_address?: string }).customer_address ?? null} />
          </div>
          <Field label="Discount"       value={order.discount_pct ? `${order.discount_pct}%` : null} />
          <Field label="Credit Checked" value={order.credit_checked ? '✓ Passed' : 'Not yet'} />
          <Field label="Reference"      value={order.reference} />
          {order.notes && (
            <div className="col-span-4">
              <Field label="Notes" value={order.notes} />
            </div>
          )}
          {order.approval_notes && (
            <div className="col-span-4">
              <Field label="Approval Notes" value={order.approval_notes} />
            </div>
          )}
          {order.cancel_reason && (
            <div className="col-span-4">
              <Field label="Cancel Reason" value={order.cancel_reason} />
            </div>
          )}
        </div>
      </div>

      {/* Line Items */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Line Items
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-8">#</th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium w-20">Qty</th>
                <th className="px-3 py-2 text-left font-medium w-14">UOM</th>
                <th className="px-3 py-2 text-right font-medium w-20">Delivered</th>
                <th className="px-3 py-2 text-right font-medium w-20">Disc%</th>
                <th className="px-3 py-2 text-right font-medium w-12">VAT%</th>
                <th className="px-3 py-2 text-right font-medium w-28">Unit Price</th>
                <th className="px-3 py-2 text-right font-medium w-28">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines?.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                  <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400">{l.item_sku ?? '—'}</td>
                  <td className="px-3 py-2 dark:text-slate-300">
                    {l.description}
                    {l.item_name && <span className="ml-1 text-slate-400">({l.item_name})</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{l.quantity}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.item_uom ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <span className={l.qty_delivered >= l.quantity ? 'text-emerald-600' : l.qty_delivered > 0 ? 'text-amber-600' : 'text-slate-400'}>
                      {l.qty_delivered}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right dark:text-slate-300">{l.discount_pct > 0 ? `${l.discount_pct}%` : '—'}</td>
                  <td className="px-3 py-2 text-right dark:text-slate-300">{l.vat_rate}%</td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(l.unit_price)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold dark:text-slate-300">{formatPHP(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={9} className="px-3 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">Subtotal</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs dark:text-slate-300">{formatPHP(order.subtotal)}</td>
              </tr>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={9} className="px-3 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">VAT</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs dark:text-slate-300">{formatPHP(order.vat_amount)}</td>
              </tr>
              <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <td colSpan={9} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total</td>
                <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(order.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          {!isTerminal && (
            <>
              {order.status === 'draft' && (
                <button onClick={() => doAction('submit')} disabled={busy}
                  className="rounded bg-amber-600 px-5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                  {busy ? 'Submitting…' : 'Submit for Approval'}
                </button>
              )}
              {order.status === 'pending_approval' && (
                <button onClick={() => setShowApprove(true)} disabled={busy}
                  className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  Approve
                </button>
              )}
              {['approved','partially_delivered'].includes(order.status) && (
                <>
                  <Link href={`/dashboard/ar/invoices/new?so_id=${order.id}`}
                    className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
                    Create Invoice
                  </Link>
                  <button onClick={() => doAction('close')} disabled={busy}
                    className="rounded bg-purple-600 px-5 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50">
                    {busy ? 'Closing…' : 'Close Order'}
                  </button>
                </>
              )}
              <button onClick={() => setShowCancel(true)} disabled={busy}
                className="rounded border border-red-300 px-5 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">
                Cancel Order
              </button>
            </>
          )}
        </div>
        {isAdmin && (
          <button onClick={handleDelete} disabled={busy}
            className="rounded border border-red-300 bg-red-50 px-4 py-1.5 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-950 dark:text-red-400">
            Delete
          </button>
        )}
      </div>

      {/* Related Invoices */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Invoices
        </div>
        {invoices.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs text-slate-400">No invoices created for this order.</div>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Invoice No.</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Due</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/ar/invoices/${inv.id}`} className="font-mono text-brand-700 hover:underline dark:text-brand-400">{inv.invoice_no}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatDate(inv.invoice_date)}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatDate(inv.due_date)}</td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(inv.total)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700 dark:text-amber-400">{formatPHP(inv.balance)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${INV_STATUS[inv.status] ?? INV_STATUS.open}`}>
                      {inv.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Approve modal */}
      {showApprove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Approve Sales Order</h2>
            <textarea rows={3} placeholder="Approval notes (optional)…" value={approveNotes}
              onChange={(e) => setApproveNotes(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            <div className="flex gap-2">
              <button onClick={() => { setShowApprove(false); doAction('approve', { notes: approveNotes }); }}
                className="flex-1 rounded bg-emerald-600 py-2 text-sm text-white hover:bg-emerald-700">
                Confirm Approval
              </button>
              <button onClick={() => setShowApprove(false)}
                className="flex-1 rounded border border-slate-300 py-2 text-sm text-slate-700 dark:text-slate-300">
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
            <textarea rows={3} placeholder="Reason for cancellation (required)…" value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            <div className="flex gap-2">
              <button disabled={!cancelReason.trim()}
                onClick={() => { setShowCancel(false); doAction('cancel', { reason: cancelReason }); }}
                className="flex-1 rounded bg-red-600 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-40">
                Confirm Cancel
              </button>
              <button onClick={() => setShowCancel(false)}
                className="flex-1 rounded border border-slate-300 py-2 text-sm text-slate-700 dark:text-slate-300">
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
