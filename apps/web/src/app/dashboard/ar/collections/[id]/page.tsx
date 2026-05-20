'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { CustomerPayment } from '@perpet/shared';
import JournalPreviewModal from '@/components/JournalPreviewModal';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:text-slate-300',
  posted: 'bg-blue-100 text-blue-700',
  cleared: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [pmt, setPmt] = useState<CustomerPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [showJEPreview, setShowJEPreview] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<CustomerPayment>(`/ar/collections/${id}`).then(setPmt).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function doPost() {
    setBusy(true); setActionMsg(null);
    try { await api.post(`/ar/collections/${id}/post`); load(); }
    catch (e: unknown) { setActionMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  async function doVoid() {
    setBusy(true); setActionMsg(null);
    try {
      await api.post(`/ar/collections/${id}/void`, { reason: voidReason });
      setShowVoid(false);
      load();
    } catch (e: unknown) { setActionMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  if (!pmt) return <div className="py-10 text-center text-sm text-red-600">Payment not found</div>;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{pmt.receipt_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[pmt.status] ?? STATUS_STYLES.draft}`}>
              {pmt.status}
            </span>
            {pmt.is_advance && (
              <span className="rounded bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700">Advance</span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{pmt.customer_name}</p>
        </div>
        <div className="flex gap-2">
          {pmt.status === 'draft' && (
            <button onClick={() => setShowJEPreview(true)} disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
              Post Receipt
            </button>
          )}
          {pmt.status === 'posted' && (
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

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: 'Payment Date', value: formatDate(pmt.payment_date) },
          { label: 'Method', value: pmt.payment_method.replace(/_/g, ' ') },
          { label: 'Amount', value: formatPHP(pmt.amount) },
          { label: 'Unapplied', value: formatPHP(pmt.unapplied_amount) },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">{f.label}</div>
            <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100 capitalize">{f.value}</div>
          </div>
        ))}
      </div>

      {pmt.reference && (
        <div className="mb-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-sm">
          <span className="text-xs text-slate-500 dark:text-slate-400">Reference: </span>
          <span className="font-mono text-slate-700 dark:text-slate-300">{pmt.reference}</span>
          {pmt.bank_ref && <span className="ml-4 font-mono text-slate-700 dark:text-slate-300"> · {pmt.bank_ref}</span>}
        </div>
      )}

      {/* Applications */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white">
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          Invoice Applications
        </div>
        {!pmt.applications?.length ? (
          <div className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            {pmt.is_advance ? 'Advance payment — not yet applied to invoices.' : 'No applications.'}
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                <th className="px-3 py-2 text-right font-medium">Amount Applied</th>
              </tr>
            </thead>
            <tbody>
              {pmt.applications.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 font-mono text-xs text-brand-700">{a.invoice_no ?? a.invoice_id}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{formatPHP(a.amount_applied)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <td className="px-3 py-2 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">Total Applied</td>
                <td className="px-3 py-2 text-right font-mono font-bold">
                  {formatPHP(pmt.applications.reduce((s, a) => s + a.amount_applied, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Void modal */}
      {showJEPreview && (
        <JournalPreviewModal
          previewUrl={`/ar/collections/${id}/journal-preview`}
          confirmLabel="Confirm Post Receipt"
          busy={busy}
          onConfirm={async () => { await doPost(); setShowJEPreview(false); }}
          onCancel={() => setShowJEPreview(false)}
        />
      )}

      {showVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Void Collection</h2>
            <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">This will reverse all invoice applications and the GL entry.</p>
            <textarea rows={3} placeholder="Void reason (required)…"
              value={voidReason} onChange={(e) => setVoidReason(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            <div className="flex gap-2">
              <button disabled={!voidReason.trim() || busy} onClick={doVoid}
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
