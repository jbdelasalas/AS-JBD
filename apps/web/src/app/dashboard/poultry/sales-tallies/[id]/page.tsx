'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface SalesTally {
  id: string; doc_no: string; status: string; transfer_date: string;
  customer_name: string | null; customer_code: string | null;
  ref_no: string | null; delivery_ref_no: string | null;
  received_by: string | null; issued_by: string | null; checked_by: string | null;
  delivery_method: string | null; plate_number: string | null; driver: string | null;
  start_time: string | null; end_time: string | null; remarks: string | null;
  lines: Array<{ id: string; line_no: number; item_name: string; sku: string; heads: number; gross_kgs: number; crate_kgs: number; net_kgs: number; unit_price: number; amount: number; }>;
}
const S: Record<string, string> = { saved: 'bg-slate-100 text-slate-600', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700' };

export default function SalesTallyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<SalesTally | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<SalesTally>(`/poultry/sales-tallies/${id}`).then(setDoc).catch(() => {}).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function action(act: string) {
    setBusy(true); setMsg(null);
    try { await api.post(`/poultry/sales-tallies/${id}/${act}`, {}); load(); }
    catch (e: unknown) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  if (!doc) return <div className="py-12 text-center text-sm text-red-500">Not found.</div>;

  const totalAmt = doc.lines.reduce((s, l) => s + Number(l.amount), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold font-mono text-slate-900 dark:text-slate-100">{doc.doc_no}</h1>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${S[doc.status] ?? ''}`}>{doc.status}</span>
          </div>
          <p className="text-sm text-slate-500">{doc.customer_code ? `${doc.customer_code} — ${doc.customer_name}` : 'Walk-in'}</p>
        </div>
        <div className="flex gap-2">
          {doc.status === 'saved' && (
            <>
              <button onClick={() => action('post')} disabled={busy} className="rounded bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Post</button>
              <button onClick={() => action('void')} disabled={busy} className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">Void</button>
            </>
          )}
          {doc.status === 'posted' && (
            <Link href={`/dashboard/poultry/deliveries/new?sales_tally_id=${doc.id}`} className="rounded bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700">Create Delivery</Link>
          )}
        </div>
      </div>
      {msg && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          {[['Date', formatDate(doc.transfer_date)], ['Plate Number', doc.plate_number ?? '—'], ['Driver', doc.driver ?? '—'], ['Delivery Method', doc.delivery_method ?? '—'], ['Start Time', doc.start_time ?? '—'], ['End Time', doc.end_time ?? '—'], ['Received By', doc.received_by ?? '—'], ['Issued By', doc.issued_by ?? '—'], ['Checked By', doc.checked_by ?? '—']].map(([l, v]) => (
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
              <th className="px-3 py-2 text-right">Heads</th>
              <th className="px-3 py-2 text-right">Gross KGS</th>
              <th className="px-3 py-2 text-right">Crate KGS</th>
              <th className="px-3 py-2 text-right">Net KGS</th>
              <th className="px-3 py-2 text-right">Unit Price</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map(l => (
              <tr key={l.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{l.sku} — {l.item_name}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.heads).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.gross_kgs).toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.crate_kgs).toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{Number(l.net_kgs).toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono">₱{Number(l.unit_price).toFixed(4)}</td>
                <td className="px-3 py-2 text-right font-mono">₱{Number(l.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <td colSpan={7} className="px-3 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Total</td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">₱{totalAmt.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
    </div>
  );
}
