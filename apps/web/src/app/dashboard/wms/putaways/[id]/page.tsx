'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Line { id: string; line_no: number; sku: string; item_name: string; uom: string; bin_code: string; lot_no: string | null; qty: number; unit_cost: number; }
interface Putaway { id: string; putaway_no: string; status: string; created_at: string; posted_at: string | null; notes: string | null; warehouse_name: string; grn_no: string | null; lines: Line[]; }

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700', posted: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700',
};

export default function PutawayDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [pa, setPa] = useState<Putaway | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<Putaway>(`/wms/putaways/${id}`).then(setPa).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function post() {
    if (!confirm('Post this put-away? Stock will be placed into the selected bins.')) return;
    setBusy(true); setError(null);
    try { await api.post(`/wms/putaways/${id}/post`); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!pa) return <div className="text-sm text-slate-500">{error ?? 'Loading…'}</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">{pa.putaway_no}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{pa.warehouse_name}{pa.grn_no ? ` · from ${pa.grn_no}` : ''} · {formatDate(pa.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[pa.status]}`}>{pa.status}</span>
          {pa.status === 'draft' && (
            <button onClick={post} disabled={busy} className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? 'Posting…' : 'Post put-away'}</button>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">Bin</th><th className="px-3 py-2 text-left">Lot</th><th className="px-3 py-2 text-right">Qty</th></tr>
          </thead>
          <tbody>
            {pa.lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300"><span className="font-mono">{l.sku}</span> – {l.item_name}</td>
                <td className="px-3 py-2 font-mono text-xs text-brand-700 dark:text-brand-400">{l.bin_code}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{l.lot_no ?? '—'}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-900 dark:text-slate-100">{Number(l.qty).toLocaleString()} {l.uom}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pa.notes && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Notes: {pa.notes}</p>}
    </div>
  );
}
