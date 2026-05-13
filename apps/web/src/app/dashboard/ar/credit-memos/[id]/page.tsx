'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { ARCreditMemo } from '@perpet/shared';

interface InvoiceRow { id: string; invoice_no: string; due_date: string; balance: number; }

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:text-slate-300',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  applied: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function CreditMemoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [cm, setCm] = useState<ARCreditMemo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showApply, setShowApply] = useState(false);
  const [openInvoices, setOpenInvoices] = useState<InvoiceRow[]>([]);
  const [applyAmts, setApplyAmts] = useState<Record<string, number>>({});
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<ARCreditMemo>(`/ar/credit-memos/${id}`).then(setCm).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function doAction(path: string, body?: object) {
    setBusy(true); setMsg(null);
    try { await api.post(`/ar/credit-memos/${id}/${path}`, body ?? {}); load(); }
    catch (e: unknown) { setMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  async function openApplyModal() {
    if (!cm) return;
    const inv = await api.get<InvoiceRow[]>(`/ar/customers/${cm.customer_id}/outstanding`).catch(() => []);
    setOpenInvoices(inv);
    const init: Record<string, number> = {};
    inv.forEach((i: InvoiceRow) => { init[i.id] = 0; });
    setApplyAmts(init);
    setShowApply(true);
  }

  async function submitApply() {
    const applications = Object.entries(applyAmts)
      .filter(([, amt]) => amt > 0)
      .map(([invoice_id, amount_applied]) => ({ invoice_id, amount_applied }));
    if (!applications.length) { setMsg('Enter at least one application amount'); return; }
    setBusy(true); setMsg(null);
    try {
      await api.post(`/ar/credit-memos/${id}/apply`, { applications });
      setShowApply(false);
      load();
    } catch (e: unknown) { setMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  if (!cm) return <div className="py-10 text-center text-sm text-red-600">Credit memo not found</div>;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{cm.cm_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[cm.status] ?? STATUS_STYLES.draft}`}>
              {cm.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{cm.customer_name}</p>
        </div>
        <div className="flex gap-2">
          {cm.status === 'draft' && (
            <button onClick={() => doAction('submit')} disabled={busy}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700 disabled:opacity-50">
              Submit for Approval
            </button>
          )}
          {cm.status === 'pending_approval' && (
            <button onClick={() => doAction('approve')} disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
              Approve
            </button>
          )}
          {cm.status === 'approved' && cm.unapplied_amount > 0 && (
            <button onClick={openApplyModal} disabled={busy}
              className="rounded border border-brand-600 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50 disabled:opacity-50">
              Apply to Invoice
            </button>
          )}
          {['draft','pending_approval'].includes(cm.status) && cm.amount_applied === 0 && (
            <button onClick={() => setShowCancel(true)} disabled={busy}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
              Cancel
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>
      )}

      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: 'CM Date', value: formatDate(cm.cm_date) },
          { label: 'Orig. Invoice', value: cm.invoice_no ?? '—' },
          { label: 'Total Credit', value: formatPHP(cm.total) },
          { label: 'Unapplied', value: formatPHP(cm.unapplied_amount) },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">{f.label}</div>
            <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{f.value}</div>
          </div>
        ))}
      </div>

      {cm.reason && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-medium">Reason: </span>{cm.reason}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white">
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300">Credit Lines</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit Price</th>
              <th className="px-3 py-2 text-right font-medium">Subtotal</th>
              <th className="px-3 py-2 text-right font-medium">VAT</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {cm.lines?.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2">{l.description}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{l.quantity}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(l.unit_price)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(l.line_subtotal)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(l.line_vat)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{formatPHP(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <td colSpan={6} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total Credit</td>
              <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(cm.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Apply modal */}
      {showApply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[480px] rounded-lg bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">Apply Credit Memo</h2>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Available: {formatPHP(cm.unapplied_amount)}. Enter amounts to apply to each invoice.
            </p>
            <table className="mb-4 min-w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="py-1 text-left font-medium">Invoice</th>
                  <th className="py-1 text-right font-medium">Balance</th>
                  <th className="py-1 text-right font-medium">Apply</th>
                </tr>
              </thead>
              <tbody>
                {openInvoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="py-1 font-mono text-brand-700">{inv.invoice_no}</td>
                    <td className="py-1 text-right">{formatPHP(inv.balance)}</td>
                    <td className="py-1 text-right">
                      <input type="number" min={0} max={Math.min(inv.balance, cm.unapplied_amount)} step="any"
                        value={applyAmts[inv.id] || ''}
                        onChange={(e) => setApplyAmts((p) => ({ ...p, [inv.id]: parseFloat(e.target.value) || 0 }))}
                        className="w-28 rounded border border-slate-300 px-1 py-0.5 text-right" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {msg && <div className="mb-3 text-xs text-red-600">{msg}</div>}
            <div className="flex gap-2">
              <button onClick={submitApply} disabled={busy}
                className="flex-1 rounded bg-brand-600 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50">
                Apply
              </button>
              <button onClick={() => setShowApply(false)} className="flex-1 rounded border border-slate-300 py-2 text-sm">
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
            <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Cancel Credit Memo</h2>
            <textarea rows={3} placeholder="Reason (required)…" value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            <div className="flex gap-2">
              <button disabled={!cancelReason.trim() || busy}
                onClick={() => { setShowCancel(false); doAction('cancel', { reason: cancelReason }); }}
                className="flex-1 rounded bg-red-600 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-40">
                Confirm
              </button>
              <button onClick={() => setShowCancel(false)} className="flex-1 rounded border border-slate-300 py-2 text-sm">
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
