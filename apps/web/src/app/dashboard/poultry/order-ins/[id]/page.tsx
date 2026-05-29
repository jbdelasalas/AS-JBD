'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface OrderIn {
  id: string; doc_no: string; status: string; transaction_date: string; date_needed: string | null;
  reference_no: string | null; delivery_method: string | null; payment_terms: string | null;
  remarks: string | null; notes: string | null; total_amount: number;
  supplier_name: string; supplier_code: string;
  lines: Array<{ id: string; line_no: number; item_name: string; sku: string; quantity: number; uom: string; unit_price: number; amount: number; remarks: string | null }>;
}

const S: Record<string, string> = { saved: 'bg-slate-100 text-slate-600', confirmed: 'bg-blue-100 text-blue-700', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700' };

export default function OrderInDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<OrderIn | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<OrderIn>(`/poultry/order-ins/${id}`).then(setDoc).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function action(act: string) {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/poultry/order-ins/${id}/${act}`, {});
      load();
    } catch (e: unknown) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  if (!doc) return <div className="py-12 text-center text-sm text-red-500">Not found.</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 font-mono">{doc.doc_no}</h1>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${S[doc.status] ?? ''}`}>{doc.status}</span>
          </div>
          <p className="text-sm text-slate-500">{doc.supplier_code} — {doc.supplier_name}</p>
        </div>
        <div className="flex gap-2">
          {doc.status === 'saved' && <button onClick={() => action('confirm')} disabled={busy} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Confirm</button>}
          {doc.status === 'confirmed' && <button onClick={() => action('post')} disabled={busy} className="rounded bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Post</button>}
          {doc.status !== 'voided' && <button onClick={() => action('void')} disabled={busy} className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">Void</button>}
          {doc.status === 'posted' && (
            <Link href={`/dashboard/poultry/inventory-ins/new?order_in_id=${doc.id}&supplier_id_hint=${doc.supplier_code}`}
              className="rounded bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700">Create Inventory In</Link>
          )}
        </div>
      </div>

      {msg && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          {[['Order Date', formatDate(doc.transaction_date)], ['Date Needed', doc.date_needed ? formatDate(doc.date_needed) : '—'], ['Reference #', doc.reference_no ?? '—'], ['Delivery Method', doc.delivery_method ?? '—'], ['Payment Terms', doc.payment_terms ?? '—']].map(([l, v]) => (
            <div key={l}><div className="text-xs text-slate-500 dark:text-slate-400">{l}</div><div className="mt-0.5 text-slate-900 dark:text-slate-100">{v}</div></div>
          ))}
          {doc.remarks && <div className="col-span-3"><div className="text-xs text-slate-500 dark:text-slate-400">Remarks</div><div className="mt-0.5 text-slate-700 dark:text-slate-300">{doc.remarks}</div></div>}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-xs">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-left">UOM</th>
              <th className="px-3 py-2 text-right">Unit Price</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map(l => (
              <tr key={l.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{l.sku} — {l.item_name}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.quantity).toLocaleString()}</td>
                <td className="px-3 py-2 text-slate-500">{l.uom}</td>
                <td className="px-3 py-2 text-right font-mono">{formatPHP(l.unit_price)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatPHP(l.amount)}</td>
                <td className="px-3 py-2 text-slate-500">{l.remarks ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <td colSpan={5} className="px-3 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Total</td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">{formatPHP(doc.total_amount)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex gap-2">
        <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
      </div>
    </div>
  );
}
