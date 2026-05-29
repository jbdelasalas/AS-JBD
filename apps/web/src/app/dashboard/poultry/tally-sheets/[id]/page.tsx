'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface TallySheet {
  id: string; doc_no: string; status: string; tally_type: string; transfer_date: string;
  grow_cycle_no: string | null; harvested_heads: number; reject_kgs: number; reject_heads: number; net_heads: number; net_kgs: number;
  received_by: string | null; issued_by: string | null; checked_by: string | null;
  delivery_method: string | null; plate_number: string | null; driver: string | null; helper: string | null;
  start_time: string | null; end_time: string | null; remarks: string | null;
  lines: Array<{ id: string; line_no: number; item_name: string; sku: string; heads: number; gross_kgs: number; crate_kgs: number; net_kgs: number; avg_weight: number | null }>;
}
const S: Record<string, string> = { saved: 'bg-slate-100 text-slate-600', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700' };

export default function TallySheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<TallySheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<TallySheet>(`/poultry/tally-sheets/${id}`).then(setDoc).catch(() => {}).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function action(act: string) {
    setBusy(true); setMsg(null);
    try { await api.post(`/poultry/tally-sheets/${id}/${act}`, {}); load(); }
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
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 capitalize">{doc.tally_type}</span>
          </div>
          {doc.grow_cycle_no && <p className="text-sm text-slate-500">Grow Cycle: {doc.grow_cycle_no}</p>}
        </div>
        <div className="flex gap-2">
          {doc.status === 'saved' && (
            <>
              <button onClick={() => action('post')} disabled={busy} className="rounded bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Post</button>
              <button onClick={() => action('void')} disabled={busy} className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">Void</button>
            </>
          )}
          {doc.status === 'posted' && (
            <Link href={`/dashboard/poultry/conversions/new?tally_sheet_id=${doc.id}`} className="rounded bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700">Create Conversion</Link>
          )}
        </div>
      </div>
      {msg && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}

      <div className="grid grid-cols-3 gap-4">
        {[['Net Heads', Number(doc.net_heads).toLocaleString()], ['Net KGS', Number(doc.net_kgs).toFixed(2)], ['Avg Weight', doc.net_heads > 0 ? (doc.net_kgs / doc.net_heads).toFixed(3) + ' kgs' : '—']].map(([l, v]) => (
          <div key={l} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">{l}</div>
            <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{v}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          {[['Transfer Date', formatDate(doc.transfer_date)], ['Plate Number', doc.plate_number ?? '—'], ['Driver', doc.driver ?? '—'], ['Helper', doc.helper ?? '—'], ['Start Time', doc.start_time ?? '—'], ['End Time', doc.end_time ?? '—'], ['Received By', doc.received_by ?? '—'], ['Issued By', doc.issued_by ?? '—'], ['Checked By', doc.checked_by ?? '—']].map(([l, v]) => (
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
              <th className="px-3 py-2 text-right">Avg Wt</th>
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
                <td className="px-3 py-2 text-right font-mono">{l.avg_weight ? Number(l.avg_weight).toFixed(3) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
    </div>
  );
}
