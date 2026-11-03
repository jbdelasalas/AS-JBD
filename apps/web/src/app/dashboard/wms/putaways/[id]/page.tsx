'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { QrLabel, LABEL_PRINT_CSS, type LabelRow } from '@/components/QrLabel';

interface Line {
  id: string; line_no: number; sku: string; item_name: string; uom: string; bin_id: string; bin_code: string; lot_no: string | null; qty: number; unit_cost: number;
  dp_output_id: string | null; pack_no: number | null; heads: number | null; box_status: string | null; box_bin_code: string | null;
}
interface Putaway { id: string; putaway_no: string; status: string; warehouse_id: string; created_at: string; posted_at: string | null; notes: string | null; warehouse_name: string; source_no: string | null; lines: Line[]; }
interface Bin { id: string; code: string; zone: string | null; }

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700', posted: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700',
};

export default function PutawayDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [pa, setPa] = useState<Putaway | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bins, setBins] = useState<Bin[]>([]);
  // line id -> new bin id, while editing bins
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  // QR labels for this put-away (packs + bins), and which kinds go to the printer.
  const [labels, setLabels] = useState<{ packs: LabelRow[]; bins: LabelRow[] } | null>(null);
  const [printKinds, setPrintKinds] = useState({ packs: true, bins: false });

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    api.get<Putaway>(`/wms/putaways/${id}`).then(setPa).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!companyId || !pa?.warehouse_id) return;
    api.get<{ data: Bin[] }>(`/wms/bins?company_id=${companyId}&warehouse_id=${pa.warehouse_id}&active=true`).then((r) => setBins(r.data)).catch(() => {});
  }, [companyId, pa?.warehouse_id]);

  async function post() {
    if (!confirm('Post this put-away? Stock will be placed into the selected bins.')) return;
    setBusy(true); setError(null);
    try { await api.post(`/wms/putaways/${id}/post`); load(); openLabels(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function openLabels() {
    setError(null);
    try {
      const r = await api.post<{ packs: LabelRow[]; bins: LabelRow[] }>(`/wms/putaways/${id}/labels`, {});
      setLabels(r);
      setPrintKinds({ packs: r.packs.length > 0, bins: r.packs.length === 0 });
    } catch (e) { setError((e as Error).message); }
  }
  const toPrint = labels ? [...(printKinds.packs ? labels.packs : []), ...(printKinds.bins ? labels.bins : [])] : [];
  function printLabels() {
    if (!toPrint.length) return;
    window.print();
    if (companyId) api.patch('/wms/scan/labels', { company_id: companyId, codes: toPrint.map((l) => l.code) }).catch(() => {});
  }

  // A posted line can only move while its pack is still in storage.
  const movable = (l: Line) => pa?.status === 'draft' || !l.dp_output_id || l.box_status === 'in_storage';
  const startEdit = () => { setNotice(null); setError(null); setEdit(Object.fromEntries((pa?.lines ?? []).map((l) => [l.id, l.bin_id]))); };
  const setAll = (binId: string) => setEdit((e) => e && Object.fromEntries(Object.entries(e).map(([k, v]) => [k, movable(pa!.lines.find((l) => l.id === k)!) ? binId : v])));

  async function saveBins() {
    if (!pa || !edit) return;
    const changes = pa.lines.filter((l) => edit[l.id] && edit[l.id] !== l.bin_id).map((l) => ({ id: l.id, bin_id: edit[l.id] }));
    if (!changes.length) { setEdit(null); return; }
    if (pa.status === 'posted' && !confirm(`Move ${changes.length} line(s) to the new bins? The stock moves from the old bins now.`)) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/wms/putaways/${id}`, { lines: changes });
      setNotice(pa.status === 'posted' ? `${changes.length} line(s) moved to the new bins.` : `${changes.length} line(s) updated.`);
      setEdit(null); load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!pa) return <div className="text-sm text-slate-500">{error ?? 'Loading…'}</div>;
  const editing = edit !== null;
  const changedCount = editing ? pa.lines.filter((l) => edit[l.id] !== l.bin_id).length : 0;
  const selectCls = 'rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="mx-auto max-w-3xl">
      <style>{LABEL_PRINT_CSS}</style>
      <div className="qr-screen-only">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">{pa.putaway_no}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{pa.warehouse_name}{pa.source_no ? ` · from ${pa.source_no}` : ''} · {formatDate(pa.created_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[pa.status]}`}>{pa.status}</span>
          {['draft', 'posted'].includes(pa.status) && !editing && (
            <button onClick={openLabels} className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Print QR labels</button>
          )}
          {['draft', 'posted'].includes(pa.status) && !editing && (
            <button onClick={startEdit} className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Edit bins</button>
          )}
          {editing && <>
            <select value="" onChange={(e) => e.target.value && setAll(e.target.value)} className={selectCls}>
              <option value="">Set all to bin…</option>
              {bins.map((b) => <option key={b.id} value={b.id}>{b.code}{b.zone ? ` · ${b.zone}` : ''}</option>)}
            </select>
            <button onClick={() => setEdit(null)} disabled={busy} className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
            <button onClick={saveBins} disabled={busy || !changedCount} className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? 'Saving…' : pa.status === 'posted' ? `Move ${changedCount || ''} line(s)` : `Save ${changedCount || ''} change(s)`}
            </button>
          </>}
          {pa.status === 'draft' && !editing && (
            <button onClick={post} disabled={busy} className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? 'Posting…' : 'Post put-away'}</button>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>}
      {labels && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
              <span className="font-medium">QR labels</span>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={printKinds.packs} disabled={!labels.packs.length} onChange={(e) => setPrintKinds((k) => ({ ...k, packs: e.target.checked }))} />
                Pack labels ({labels.packs.length})
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={printKinds.bins} disabled={!labels.bins.length} onChange={(e) => setPrintKinds((k) => ({ ...k, bins: e.target.checked }))} />
                Bin labels ({labels.bins.length})
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setLabels(null)} className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Close</button>
              <button onClick={printLabels} disabled={!toPrint.length} className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">Print {toPrint.length} label(s)</button>
            </div>
          </div>
          {pa.status === 'draft' && <p className="mt-2 text-[11px] text-slate-500">Pack labels are made when the put-away is posted — post it first to print them.</p>}
          {pa.status === 'posted' && !labels.packs.length && <p className="mt-2 text-[11px] text-slate-500">No packs in storage from this put-away (shipped, or not a production put-away).</p>}
          {toPrint.length > 0 && (
            <div className="mt-3 grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {toPrint.slice(0, 6).map((r) => <QrLabel key={r.code} row={r} />)}
              {toPrint.length > 6 && <p className="self-center text-xs text-slate-500">…and {toPrint.length - 6} more</p>}
            </div>
          )}
        </div>
      )}
      {editing && pa.status === 'posted' && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This put-away is posted — changing a bin moves the stock (and the pack) from its current bin to the new one. Packs that shipped or are on a pick list can't be moved here.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">Bin</th><th className="px-3 py-2 text-left">Lot</th><th className="px-3 py-2 text-right">Qty</th></tr>
          </thead>
          <tbody>
            {pa.lines.map((l) => {
              const moved = l.box_bin_code && l.box_bin_code !== l.bin_code;
              return (
                <tr key={l.id} className={`border-t border-slate-100 dark:border-slate-800 ${editing && edit[l.id] !== l.bin_id ? 'bg-amber-50/70 dark:bg-amber-900/10' : ''}`}>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
                    {l.pack_no != null && <span className="mr-1 font-mono text-slate-400">#{l.pack_no}</span>}
                    <span className="font-mono">{l.sku}</span> – {l.item_name}
                    {l.heads ? <span className="text-slate-500"> · {l.heads} hd</span> : null}
                    {l.box_status && l.box_status !== 'in_storage' && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500 dark:bg-slate-800">{l.box_status}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-brand-700 dark:text-brand-400">
                    {editing && movable(l) ? (
                      <select value={edit[l.id]} onChange={(e) => setEdit((x) => x && { ...x, [l.id]: e.target.value })} className={selectCls}>
                        {!bins.some((b) => b.id === l.bin_id) && <option value={l.bin_id}>{l.bin_code}</option>}
                        {bins.map((b) => <option key={b.id} value={b.id}>{b.code}{b.zone ? ` · ${b.zone}` : ''}</option>)}
                      </select>
                    ) : (
                      <>{l.bin_code}{moved && <span className="ml-1 font-sans text-[11px] text-slate-500">(now in {l.box_bin_code})</span>}</>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{l.lot_no ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-900 dark:text-slate-100">{Number(l.qty).toLocaleString(undefined, { maximumFractionDigits: 3 })} {l.uom}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pa.notes && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Notes: {pa.notes}</p>}
      </div>

      {/* Print-only sticker sheet. */}
      <div id="print-sheet" className="hidden">
        {toPrint.map((r) => <QrLabel key={r.code} row={r} />)}
      </div>
    </div>
  );
}
