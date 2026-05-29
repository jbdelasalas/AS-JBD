'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface Invoice {
  id: string; doc_no: string; status: string; payment_status: string;
  invoice_date: string; due_date: string | null;
  customer_name: string; customer_code: string; customer_tin: string | null;
  delivery_no: string | null; remarks: string | null;
  subtotal: number; vat_amount: number; total_amount: number; paid_amount: number; balance_due: number;
  lines: Array<{ id: string; line_no: number; item_name: string; sku: string; description: string | null; heads: number; kgs: number; unit_price: number; discount_pct: number; amount: number; vat_rate: number; }>;
}
const S: Record<string, string> = { draft: 'bg-slate-100 text-slate-600', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700' };
const PS: Record<string, string> = { unpaid: 'bg-red-100 text-red-700', partial: 'bg-amber-100 text-amber-700', paid: 'bg-emerald-100 text-emerald-700' };

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Invoice>(`/poultry/invoices/${id}`).then(setDoc).catch(() => {}).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function action(act: string) {
    setBusy(true); setMsg(null);
    try { await api.post(`/poultry/invoices/${id}/${act}`, {}); load(); }
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
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${PS[doc.payment_status] ?? 'bg-slate-100 text-slate-600'}`}>{doc.payment_status}</span>
          </div>
          <p className="text-sm text-slate-500">{doc.customer_code} — {doc.customer_name}{doc.customer_tin ? ` · TIN: ${doc.customer_tin}` : ''}</p>
        </div>
        <div className="flex gap-2">
          {doc.status === 'draft' && <button onClick={() => action('post')} disabled={busy} className="rounded bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Post Invoice</button>}
          {doc.status !== 'voided' && <button onClick={() => action('void')} disabled={busy} className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">Void</button>}
        </div>
      </div>
      {msg && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}

      <div className="grid grid-cols-3 gap-4">
        {[['Total Amount', formatPHP(doc.total_amount)], ['Paid', formatPHP(doc.paid_amount)], ['Balance Due', formatPHP(doc.balance_due)]].map(([l, v], idx) => (
          <div key={l} className={`rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 ${idx === 2 && doc.balance_due > 0 ? 'border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800' : ''}`}>
            <div className="text-xs text-slate-500">{l}</div>
            <div className={`mt-1 text-xl font-semibold ${idx === 2 && doc.balance_due > 0 ? 'text-red-600' : 'text-slate-900 dark:text-slate-100'}`}>{v}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          {[['Invoice Date', formatDate(doc.invoice_date)], ['Due Date', doc.due_date ? formatDate(doc.due_date) : '—'], ['Linked Delivery', doc.delivery_no ?? '—'], ['Remarks', doc.remarks ?? '—']].map(([l, v]) => (
            <div key={l}><div className="text-xs text-slate-500">{l}</div><div className="mt-0.5 text-slate-900 dark:text-slate-100">{v}</div></div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-xs">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">Heads</th>
              <th className="px-3 py-2 text-right">KGS</th>
              <th className="px-3 py-2 text-right">Unit Price</th>
              <th className="px-3 py-2 text-right">Disc %</th>
              <th className="px-3 py-2 text-right">VAT %</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map(l => (
              <tr key={l.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{l.sku}</td>
                <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{l.description ?? l.item_name}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.heads).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.kgs).toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatPHP(l.unit_price)}</td>
                <td className="px-3 py-2 text-right font-mono">{l.discount_pct > 0 ? `${l.discount_pct}%` : '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{l.vat_rate}%</td>
                <td className="px-3 py-2 text-right font-mono">{formatPHP(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <td colSpan={8} className="px-3 py-1 text-right text-xs text-slate-500">Subtotal</td>
              <td className="px-3 py-1 text-right font-mono">{formatPHP(doc.subtotal)}</td>
            </tr>
            <tr className="bg-slate-50 dark:bg-slate-800">
              <td colSpan={8} className="px-3 py-1 text-right text-xs text-slate-500">VAT</td>
              <td className="px-3 py-1 text-right font-mono">{formatPHP(doc.vat_amount)}</td>
            </tr>
            <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <td colSpan={8} className="px-3 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Grand Total</td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">{formatPHP(doc.total_amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
    </div>
  );
}
