'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

interface ReturnLine {
  id: string; line_no: number; item_id: string; item_name: string | null; item_sku: string | null;
  description: string; qty_return: number; unit_cost: number; unit_price: number;
  vat_rate: number; discount_pct: number; remarks: string | null;
}
interface ReturnDoc {
  id: string; return_no: string; return_date: string; status: string;
  dr_id: string; dr_no: string | null; dr_delivery_date: string | null;
  customer_id: string; customer_name: string | null;
  reason: string | null; je_id: string | null;
  lines: ReturnLine[];
}

const STATUS_COLORS: Record<string, string> = {
  saved:  'bg-slate-100 text-slate-700',
  posted: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

export default function ReturnGoodsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const [doc, setDoc]     = useState<ReturnDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const load = useCallback(() => {
    api.get<ReturnDoc>(`/sales/return-goods/${id}`)
      .then(setDoc)
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function doPost() {
    if (!window.confirm('Post this return? Journal entry and inventory adjustment will be created.')) return;
    setBusy(true); setMsg(null);
    try {
      await api.post(`/sales/return-goods/${id}/post`, {});
      setMsg({ text: 'Posted successfully', type: 'success' });
      load();
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message ?? 'Post failed', type: 'error' });
    } finally { setBusy(false); }
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  if (!doc)    return <div className="py-12 text-center text-sm text-red-600">Return goods not found.</div>;

  const totalRevenue = doc.lines.reduce((s, l) => s + Number(l.qty_return) * Number(l.unit_price), 0);
  const totalCost    = doc.lines.reduce((s, l) => s + Number(l.qty_return) * Number(l.unit_cost),  0);
  const totalQty     = doc.lines.reduce((s, l) => s + Number(l.qty_return), 0);

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Return Goods</h1>
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-xl">←</button>
      </div>

      {msg && (
        <div className={`rounded border px-3 py-2 text-sm ${msg.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {/* Header card */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-4 gap-5">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Return #</div>
            <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">{doc.return_no}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Return Date</div>
            <div className="text-sm text-slate-800 dark:text-slate-200">
              {doc.return_date ? new Date(doc.return_date).toLocaleDateString('en-PH') : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">DR Reference</div>
            <div className="text-sm">
              <Link href={`/dashboard/sales/delivery-receipts/${doc.dr_id}`}
                className="font-mono font-medium text-brand-600 hover:underline dark:text-brand-400">
                {doc.dr_no ?? doc.dr_id}
              </Link>
              {doc.dr_delivery_date && (
                <span className="ml-1.5 text-xs text-slate-400">
                  {new Date(doc.dr_delivery_date).toLocaleDateString('en-PH')}
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Status</div>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[doc.status] ?? 'bg-slate-100 text-slate-600'}`}>
              {doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
            </span>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Customer</div>
            <div className="text-sm text-slate-800 dark:text-slate-200">{doc.customer_name ?? '—'}</div>
          </div>
          <div className="col-span-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Reason</div>
            <div className="text-sm text-slate-800 dark:text-slate-200">{doc.reason || <span className="text-slate-400">—</span>}</div>
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Return Lines</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500">
              <tr>
                {['#', 'Item', 'Return (KGS)', 'Unit Cost', 'Unit Price', 'Return Revenue', 'Return Cost'].map(h => (
                  <th key={h} className={`px-4 py-2 font-medium ${h === '#' || h === 'Item' ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {doc.lines.map(l => (
                <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{l.line_no}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800 dark:text-slate-200">{l.item_name ?? l.description}</div>
                    {l.item_sku && <div className="text-xs text-slate-400">{l.item_sku}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300">{Number(l.qty_return).toFixed(4)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300">₱{Number(l.unit_cost).toLocaleString('en-PH', { minimumFractionDigits: 4 })}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300">₱{Number(l.unit_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">₱{(Number(l.qty_return) * Number(l.unit_price)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">₱{(Number(l.qty_return) * Number(l.unit_cost)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800">
              <tr>
                <td colSpan={2} className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Totals</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-200">{totalQty.toFixed(4)}</td>
                <td colSpan={2}></td>
                <td className="px-4 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-200">₱{totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-200">₱{totalCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* JE Preview (when posted) */}
      {doc.status === 'posted' && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">Journal Entry</h3>
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 text-slate-400">
                <th className="pb-1.5 text-left">Account</th>
                <th className="pb-1.5 text-right">Debit</th>
                <th className="pb-1.5 text-right">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50 text-slate-700 dark:text-slate-300">
              <tr><td className="py-1.5">DR Sales DR-Dressed (Revenue reversal)</td><td className="py-1.5 text-right font-mono">₱{totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td><td></td></tr>
              <tr><td className="py-1.5">DR Dressed Inventory (Goods returned)</td><td className="py-1.5 text-right font-mono">₱{totalCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td><td></td></tr>
              <tr><td className="py-1.5">CR COS Dressed (COGS reversal)</td><td></td><td className="py-1.5 text-right font-mono">₱{totalCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td></tr>
              <tr><td className="py-1.5">CR Accounts Receivable</td><td></td><td className="py-1.5 text-right font-mono">₱{totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {doc.status === 'saved' && (
          <button onClick={doPost} disabled={busy}
            className="rounded bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Posting…' : 'Post Return'}
          </button>
        )}
        {doc.je_id && (
          <Link href={`/dashboard/gl/journal-entries/${doc.je_id}`}
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            View Journal Entry
          </Link>
        )}
        <Link href={`/dashboard/sales/return-goods`}
          className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
          Back to List
        </Link>
      </div>
    </div>
  );
}
