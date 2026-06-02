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
  po_no: string | null; supplier_name: string | null;
  branch_name: string | null; target_branch_name: string | null;
  doa_heads: number; doa_kgs: number;
  short_over_heads: number; short_over_kgs: number;
  outputs: Array<{
    id: string; line_no: number; item_name: string; sku: string; category: string | null;
    heads: number; kgs: number; unit_cost: number; total_cost: number; delivery_ref_no: string | null;
  }>;
}

const S: Record<string, string> = {
  saved:  'bg-slate-100 text-slate-600',
  posted: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm text-slate-900 dark:text-slate-100">{value ?? <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

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

  const totalOutHeads = doc.outputs.reduce((s, o) => s + Number(o.heads), 0);

  return (
    <div className="space-y-0">
      {/* Page header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Item Conversion</h1>
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-xl leading-none">←</button>
      </div>

      {msg && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}

      {/* Header card */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
        <div className="grid grid-cols-4 gap-x-8 gap-y-5">
          <Field label="Transaction No." value={<span className="font-mono">{doc.doc_no}</span>} />
          <Field label="Transaction Date" value={formatDate(doc.transaction_date)} />
          <Field label="Purchase Order" value={doc.po_no ? `${doc.po_no}${doc.supplier_name ? ` — ${doc.supplier_name}` : ''}` : null} />
          <Field label="Status" value={
            <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${S[doc.status] ?? ''}`}>
              {doc.status.toUpperCase()}
            </span>
          } />
          <Field label="Source Location" value={doc.branch_name} />
          <div className="col-span-2"><Field label="Remarks" value={doc.remarks} /></div>
          <div />
          <Field label="Target Location" value={doc.target_branch_name} />
          {doc.tally_sheet_no && <Field label="Tally Sheet" value={doc.tally_sheet_no} />}
        </div>
      </div>

      {/* Source Item */}
      <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Source Item</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Line No.</th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Unit</th>
                <th className="px-3 py-2 text-right font-medium">Heads</th>
                <th className="px-3 py-2 text-right font-medium">Quantity (KGS)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-50 dark:border-slate-700">
                <td className="px-3 py-2 text-slate-400">1</td>
                <td className="px-3 py-2 font-medium dark:text-slate-200">{doc.source_sku} — {doc.source_item_name}</td>
                <td className="px-3 py-2 text-slate-500">heads</td>
                <td className="px-3 py-2 text-right font-mono">{Number(doc.source_heads).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(doc.source_kgs).toFixed(6)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* DOA + Short/Over */}
        {(doc.doa_heads > 0 || doc.doa_kgs > 0 || doc.short_over_heads !== 0 || doc.short_over_kgs !== 0) && (
          <div className="border-t border-slate-100 dark:border-slate-700 px-6 py-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">DOA &amp; Variance</div>
            <div className="grid grid-cols-4 gap-x-8 gap-y-3">
              <Field label="DOA Heads" value={Number(doc.doa_heads).toLocaleString()} />
              <Field label="DOA KGS" value={Number(doc.doa_kgs).toFixed(4)} />
              <Field label="Short / Over Heads" value={
                <span className={Number(doc.short_over_heads) < 0 ? 'text-red-600' : Number(doc.short_over_heads) > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                  {Number(doc.short_over_heads) > 0 ? '+' : ''}{Number(doc.short_over_heads).toLocaleString()}
                </span>
              } />
              <Field label="Short / Over KGS" value={
                <span className={Number(doc.short_over_kgs) < 0 ? 'text-red-600' : Number(doc.short_over_kgs) > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                  {Number(doc.short_over_kgs) > 0 ? '+' : ''}{Number(doc.short_over_kgs).toFixed(4)}
                </span>
              } />
            </div>
          </div>
        )}
      </div>

      {/* Output Items */}
      <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Output Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Line No.</th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Unit</th>
                <th className="px-3 py-2 text-right font-medium">Heads</th>
                <th className="px-3 py-2 text-right font-medium">Quantity (KGS)</th>
                <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
                <th className="px-3 py-2 text-right font-medium">Total Cost</th>
                <th className="px-3 py-2 text-left font-medium">Delivery Ref No.</th>
              </tr>
            </thead>
            <tbody>
              {doc.outputs.map(o => (
                <tr key={o.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                  <td className="px-3 py-2 text-slate-400">{o.line_no}</td>
                  <td className="px-3 py-2 font-medium dark:text-slate-200">
                    {o.category && <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{o.category}</span>}
                    {o.sku} — {o.item_name}
                  </td>
                  <td className="px-3 py-2 text-slate-500">kgs</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(o.heads).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(o.kgs).toFixed(6)}</td>
                  <td className="px-3 py-2 text-right font-mono">₱{Number(o.unit_cost).toFixed(4)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">₱{Number(o.total_cost).toFixed(2)}</td>
                  <td className="px-3 py-2 text-slate-500">{o.delivery_ref_no ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold">
                <td colSpan={3} className="px-3 py-2 text-right text-xs text-slate-500">Total</td>
                <td className="px-3 py-2 text-right font-mono">{totalOutHeads.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(doc.total_output_kgs).toFixed(6)}</td>
                <td />
                <td className="px-3 py-2 text-right font-mono">₱{doc.outputs.reduce((s, o) => s + Number(o.total_cost), 0).toFixed(2)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Yield summary */}
        <div className="border-t border-slate-100 dark:border-slate-700 px-6 py-3 flex gap-8 text-xs text-slate-500">
          <span>Source KGS: <strong className="text-slate-800 dark:text-slate-200">{Number(doc.source_kgs).toFixed(2)}</strong></span>
          <span>Output KGS: <strong className="text-slate-800 dark:text-slate-200">{Number(doc.total_output_kgs).toFixed(2)}</strong></span>
          <span>Yield: <strong className="text-slate-800 dark:text-slate-200">{doc.yield_pct != null ? `${doc.yield_pct}%` : '—'}</strong></span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-6 flex gap-3">
        {doc.status === 'saved' && (
          <>
            <button onClick={() => action('post')} disabled={busy}
              className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Post</button>
            <button onClick={() => action('void')} disabled={busy}
              className="rounded border border-red-300 px-5 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">Void</button>
          </>
        )}
        {doc.status === 'posted' && (
          <Link href={`/dashboard/poultry/deliveries/new?conversion_id=${doc.id}`}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Create Delivery
          </Link>
        )}
      </div>
    </div>
  );
}
