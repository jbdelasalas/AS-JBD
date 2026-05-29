'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface Delivery {
  id: string; doc_no: string; status: string; transaction_date: string; commitment_date: string | null;
  customer_name: string; customer_code: string; customer_address: string | null;
  delivery_method: string | null; delivery_address: string | null; plate_number: string | null; driver: string | null;
  reference_no: string | null; remarks: string | null; total_heads: number; total_kgs: number; total_amount: number;
  lines: Array<{ id: string; line_no: number; item_name: string; sku: string; heads: number; kgs: number; unit_price: number; discount_pct: number; amount: number; remarks: string | null; }>;
}
const S: Record<string, string> = { saved: 'bg-slate-100 text-slate-600', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700' };

export default function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Delivery>(`/poultry/deliveries/${id}`).then(setDoc).catch(() => {}).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function action(act: string) {
    setBusy(true); setMsg(null);
    try { await api.post(`/poultry/deliveries/${id}/${act}`, {}); load(); }
    catch (e: unknown) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  if (!doc) return <div className="py-12 text-center text-sm text-red-500">Not found.</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold font-mono text-slate-900 dark:text-slate-100">{doc.doc_no}</h1>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${S[doc.status] ?? ''}`}>{doc.status}</span>
          </div>
          <p className="text-sm text-slate-500">{doc.customer_code} — {doc.customer_name}</p>
        </div>
        <div className="flex gap-2">
          {doc.status === 'saved' && (
            <>
              <button onClick={() => action('post')} disabled={busy} className="rounded bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Post (Deduct Inventory)</button>
              <button onClick={() => action('void')} disabled={busy} className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">Void</button>
            </>
          )}
          {doc.status === 'posted' && (
            <Link href={`/dashboard/poultry/invoices/new?delivery_id=${doc.id}`} className="rounded bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700">Create Invoice</Link>
          )}
        </div>
      </div>
      {msg && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}

      <div className="grid grid-cols-3 gap-4">
        {[['Total Heads', Number(doc.total_heads).toLocaleString()], ['Total KGS', Number(doc.total_kgs).toFixed(2)], ['Total Amount', formatPHP(doc.total_amount)]].map(([l, v]) => (
          <div key={l} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">{l}</div>
            <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{v}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          {[['Date', formatDate(doc.transaction_date)], ['Commitment Date', doc.commitment_date ? formatDate(doc.commitment_date) : '—'], ['Reference No.', doc.reference_no ?? '—'], ['Delivery Method', doc.delivery_method ?? '—'], ['Plate Number', doc.plate_number ?? '—'], ['Driver', doc.driver ?? '—'], ['Delivery Address', doc.delivery_address ?? doc.customer_address ?? '—']].map(([l, v]) => (
            <div key={l} className={l === 'Delivery Address' ? 'col-span-3' : ''}><div className="text-xs text-slate-500">{l}</div><div className="mt-0.5 text-slate-900 dark:text-slate-100">{v}</div></div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-xs">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Heads</th>
              <th className="px-3 py-2 text-right">KGS</th>
              <th className="px-3 py-2 text-right">Unit Price</th>
              <th className="px-3 py-2 text-right">Disc %</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map(l => (
              <tr key={l.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{l.sku} — {l.item_name}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.heads).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.kgs).toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatPHP(l.unit_price)}</td>
                <td className="px-3 py-2 text-right font-mono">{l.discount_pct > 0 ? `${l.discount_pct}%` : '—'}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{formatPHP(l.amount)}</td>
                <td className="px-3 py-2 text-slate-500">{l.remarks ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <td colSpan={6} className="px-3 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Total</td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">{formatPHP(doc.total_amount)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
    </div>
  );
}
