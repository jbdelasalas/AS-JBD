'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Conversion {
  id: string; doc_no: string; status: string; transaction_date: string; remarks: string | null;
  source_item_name: string; source_sku: string; source_heads: number; source_kgs: number;
  total_output_kgs: number; yield_pct: number | null; tally_sheet_no: string | null;
  outputs: Array<{ id: string; line_no: number; item_name: string; sku: string; heads: number; kgs: number; unit_cost: number; total_cost: number }>;
}
const S: Record<string, string> = { saved: 'bg-slate-100 text-slate-600', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700' };

export default function ConversionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<Conversion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Conversion>(`/poultry/conversions/${id}`).then(setDoc).catch(() => {}).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function action(act: string) {
    setBusy(true); setMsg(null);
    try { await api.post(`/poultry/conversions/${id}/${act}`, {}); load(); }
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
          <p className="text-sm text-slate-500">{doc.source_sku} — {doc.source_item_name}</p>
        </div>
        <div className="flex gap-2">
          {doc.status === 'saved' && (
            <>
              <button onClick={() => action('post')} disabled={busy} className="rounded bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Post</button>
              <button onClick={() => action('void')} disabled={busy} className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">Void</button>
            </>
          )}
          {doc.status === 'posted' && (
            <Link href={`/dashboard/poultry/deliveries/new?conversion_id=${doc.id}`} className="rounded bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700">Create Delivery</Link>
          )}
        </div>
      </div>
      {msg && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}

      <div className="grid grid-cols-4 gap-4">
        {[['Source Heads', Number(doc.source_heads).toLocaleString()], ['Source KGS', Number(doc.source_kgs).toFixed(2)], ['Output KGS', Number(doc.total_output_kgs).toFixed(2)], ['Yield', doc.yield_pct != null ? `${doc.yield_pct}%` : '—']].map(([l, v]) => (
          <div key={l} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">{l}</div>
            <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{v}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          {[['Date', formatDate(doc.transaction_date)], ['Tally Sheet', doc.tally_sheet_no ?? '—'], ['Remarks', doc.remarks ?? '—']].map(([l, v]) => (
            <div key={l}><div className="text-xs text-slate-500">{l}</div><div className="mt-0.5 text-slate-900 dark:text-slate-100">{v}</div></div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300">Output Products</div>
        <table className="min-w-full text-xs">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Heads</th>
              <th className="px-3 py-2 text-right">KGS</th>
              <th className="px-3 py-2 text-right">Unit Cost</th>
              <th className="px-3 py-2 text-right">Total Cost</th>
            </tr>
          </thead>
          <tbody>
            {doc.outputs.map(o => (
              <tr key={o.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 text-slate-400">{o.line_no}</td>
                <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{o.sku} — {o.item_name}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(o.heads).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(o.kgs).toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono">₱{Number(o.unit_cost).toFixed(4)}</td>
                <td className="px-3 py-2 text-right font-mono">₱{Number(o.total_cost).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
    </div>
  );
}
