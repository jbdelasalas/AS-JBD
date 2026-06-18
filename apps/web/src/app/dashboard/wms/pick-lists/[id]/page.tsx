'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Line { id: string; line_no: number; sku: string; item_name: string; uom: string; bin_code: string; lot_no: string | null; qty_to_pick: number; qty_picked: number; bin_available: number; }
interface PickList { id: string; pick_no: string; status: string; created_at: string; notes: string | null; warehouse_name: string; order_no: string | null; lines: Line[]; }

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700', picking: 'bg-amber-100 text-amber-700',
  picked: 'bg-sky-100 text-sky-700', packed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700',
};

export default function PickListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [pl, setPl] = useState<PickList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { api.get<PickList>(`/wms/pick-lists/${id}`).then(setPl).catch((e) => setError(e.message)); }, [id]);
  useEffect(() => { load(); }, [load]);

  async function confirmPick() {
    setBusy(true); setError(null);
    try { await api.post(`/wms/pick-lists/${id}/pick`, {}); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function pack() {
    setBusy(true); setError(null);
    try { await api.post(`/wms/pick-lists/${id}/pack`, {}); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!pl) return <div className="text-sm text-slate-500">{error ?? 'Loading…'}</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">{pl.pick_no}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{pl.warehouse_name}{pl.order_no ? ` · ${pl.order_no}` : ''} · {formatDate(pl.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[pl.status]}`}>{pl.status}</span>
          {['draft', 'picking'].includes(pl.status) && (
            <button onClick={confirmPick} disabled={busy} className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? '…' : 'Confirm pick'}</button>
          )}
          {pl.status === 'picked' && (
            <button onClick={pack} disabled={busy} className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? '…' : 'Mark packed'}</button>
          )}
          {pl.status === 'packed' && (
            <Link href={`/dashboard/wms/shipments/new?pick_id=${pl.id}`} className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">Create shipment</Link>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">Bin</th><th className="px-3 py-2 text-left">Lot</th><th className="px-3 py-2 text-right">To pick</th><th className="px-3 py-2 text-right">Picked</th><th className="px-3 py-2 text-right">Avail</th></tr>
          </thead>
          <tbody>
            {pl.lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300"><span className="font-mono">{l.sku}</span> – {l.item_name}</td>
                <td className="px-3 py-2 font-mono text-xs text-brand-700 dark:text-brand-400">{l.bin_code}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{l.lot_no ?? '—'}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-900 dark:text-slate-100">{Number(l.qty_to_pick).toLocaleString()} {l.uom}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-700 dark:text-slate-300">{Number(l.qty_picked).toLocaleString()}</td>
                <td className={`px-3 py-2 text-right text-xs tabular-nums ${Number(l.bin_available) < Number(l.qty_to_pick) ? 'text-red-600' : 'text-slate-500'}`}>{Number(l.bin_available).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pl.notes && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Notes: {pl.notes}</p>}
    </div>
  );
}
