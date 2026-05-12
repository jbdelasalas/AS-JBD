'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { SalesInvoice } from '@perpet/shared';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  open: 'bg-blue-100 text-blue-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

export default function SalesInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<SalesInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<SalesInvoice>(`/ar/invoices/${id}`).then(setInv).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function doPost() {
    setBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/ar/invoices/${id}/post`);
      load();
    } catch (e: unknown) {
      setActionMsg((e as Error).message ?? 'Failed');
    } finally { setBusy(false); }
  }

  async function doVoid() {
    setBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/ar/invoices/${id}/void`, { reason: voidReason });
      setShowVoid(false);
      load();
    } catch (e: unknown) {
      setActionMsg((e as Error).message ?? 'Failed');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!inv) return <div className="py-10 text-center text-sm text-red-600">Invoice not found</div>;

  const paidPct = inv.total > 0 ? Math.min((inv.amount_paid / inv.total) * 100, 100) : 0;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">{inv.invoice_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[inv.status] ?? STATUS_STYLES.draft}`}>
              {inv.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">{inv.customer_name}</p>
        </div>
        <div className="flex gap-2">
          {inv.status === 'draft' && (
            <button onClick={doPost} disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
              Post Invoice
            </button>
          )}
          {['open','overdue','partially_paid'].includes(inv.status) && (
            <Link href={`/dashboard/ar/collections/new?invoice_id=${id}&customer_id=${inv.customer_id}`}
              className="rounded border border-brand-600 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50">
              Record Payment
            </Link>
          )}
          {['draft','open'].includes(inv.status) && inv.amount_paid === 0 && (
            <button onClick={() => setShowVoid(true)} disabled={busy}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
              Void
            </button>
          )}
        </div>
      </div>

      {actionMsg && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionMsg}</div>
      )}

      {/* Payment progress */}
      {inv.status !== 'draft' && inv.status !== 'cancelled' && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>Payment Progress</span>
            <span>{paidPct.toFixed(1)}% paid</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100">
            <div
              className={`h-2 rounded-full transition-all ${paidPct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`}
              style={{ width: `${paidPct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs text-slate-500">
            <span>Paid: {formatPHP(inv.amount_paid)}</span>
            <span>Balance: {formatPHP(inv.balance)}</span>
          </div>
        </div>
      )}

      {/* Info cards */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: 'Invoice Date', value: formatDate(inv.invoice_date) },
          { label: 'Due Date', value: formatDate(inv.due_date) },
          { label: 'Payment Terms', value: `${inv.payment_terms_days} days` },
          { label: 'SO Reference', value: inv.order_no ?? '—' },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-500">{f.label}</div>
            <div className="mt-0.5 font-medium text-slate-900">{f.value}</div>
          </div>
        ))}
      </div>

      {/* Lines */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">Invoice Lines</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit Price</th>
              <th className="px-3 py-2 text-right font-medium">Disc %</th>
              <th className="px-3 py-2 text-right font-medium">VAT %</th>
              <th className="px-3 py-2 text-right font-medium">Subtotal</th>
              <th className="px-3 py-2 text-right font-medium">VAT</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines?.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-xs text-slate-500">{l.line_no}</td>
                <td className="px-3 py-2">{l.description}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{l.quantity}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(l.unit_price)}</td>
                <td className="px-3 py-2 text-right text-xs">{l.discount_pct}%</td>
                <td className="px-3 py-2 text-right text-xs">{l.vat_rate}%</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(l.line_subtotal)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(l.line_vat)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{formatPHP(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {[
              { label: 'Subtotal', value: inv.subtotal },
              { label: 'VAT (12%)', value: inv.vat_amount },
            ].map((row) => (
              <tr key={row.label} className="bg-slate-50">
                <td colSpan={8} className="px-3 py-1.5 text-right text-xs text-slate-600">{row.label}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{formatPHP(row.value)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-slate-50">
              <td colSpan={8} className="px-3 py-2 text-right text-sm font-semibold text-slate-900">Total</td>
              <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900">{formatPHP(inv.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Void modal */}
      {showVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Void Invoice</h2>
            <textarea rows={3} placeholder="Reason for voiding (required)…"
              value={voidReason} onChange={(e) => setVoidReason(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button disabled={!voidReason.trim() || busy}
                onClick={doVoid}
                className="flex-1 rounded bg-red-600 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-40">
                Confirm Void
              </button>
              <button onClick={() => setShowVoid(false)} className="flex-1 rounded border border-slate-300 py-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
