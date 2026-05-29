'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface InvIn {
  id: string; doc_no: string; status: string; transaction_date: string;
  supplier_name: string; supplier_code: string; warehouse_name: string | null;
  order_in_no: string | null; delivery_method: string | null; contact_person: string | null; remarks: string | null;
  lines: Array<{ id: string; line_no: number; item_name: string; sku: string; batch_no: string | null; quantity_received: number; quantity_doa: number; net_quantity: number; unit_cost: number; total_cost: number; }>;
}
const S: Record<string, string> = { saved: 'bg-slate-100 text-slate-600', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700' };

export default function InventoryInDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<InvIn | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<InvIn>(`/poultry/inventory-ins/${id}`).then(setDoc).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function action(act: string) {
    setBusy(true); setMsg(null);
    try { await api.post(`/poultry/inventory-ins/${id}/${act}`, {}); load(); }
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
          <p className="text-sm text-slate-500">{doc.supplier_code} — {doc.supplier_name}</p>
        </div>
        <div className="flex gap-2">
          {doc.status === 'saved' && <button onClick={() => action('post')} disabled={busy} className="rounded bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Post (Create Batches)</button>}
          {doc.status !== 'voided' && <button onClick={() => action('void')} disabled={busy} className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">Void</button>}
          {doc.status === 'posted' && <Link href="/dashboard/poultry/grow-cycles/new" className="rounded bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700">Create Grow Cycle</Link>}
        </div>
      </div>
      {msg && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          {[['Receipt Date', formatDate(doc.transaction_date)], ['Warehouse', doc.warehouse_name ?? '—'], ['Order In', doc.order_in_no ?? '—'], ['Delivery Method', doc.delivery_method ?? '—'], ['Contact Person', doc.contact_person ?? '—']].map(([l, v]) => (
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
              <th className="px-3 py-2 text-left">Batch No.</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2 text-right">DOA</th>
              <th className="px-3 py-2 text-right">Net</th>
              <th className="px-3 py-2 text-right">Unit Cost</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map(l => (
              <tr key={l.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{l.sku} — {l.item_name}</td>
                <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">{l.batch_no ?? <span className="italic text-slate-400">Auto</span>}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.quantity_received).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-red-500">{Number(l.quantity_doa).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{Number(l.net_quantity).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">₱{Number(l.unit_cost).toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono">₱{Number(l.total_cost).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
    </div>
  );
}
