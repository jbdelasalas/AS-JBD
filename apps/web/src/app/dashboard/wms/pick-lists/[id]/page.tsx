'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { qrSvg } from '@/lib/qr';
import QrScanner from '@/components/QrScanner';

interface Line {
  id: string; line_no: number; sku: string; item_name: string; uom: string; bin_id: string; bin_code: string; bin_zone: string | null; lot_no: string | null;
  qty_to_pick: number; qty_picked: number; bin_available: number;
  box_id: string | null; pack_no: number | null; heads: number | null; batch_no: string | null;
  bin_scanned_at: string | null; box_scanned_at: string | null;
}
interface PickList {
  id: string; pick_no: string; status: string; created_at: string; notes: string | null; warehouse_name: string;
  order_no: string | null; customer_name: string | null; delivery_date: string | null;
  created_by_name: string | null; picked_by_name: string | null; lines: Line[];
}
interface ScanResult { kind: 'bin' | 'box'; bin_id?: string; bin_code?: string; message: string }

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700', picking: 'bg-amber-100 text-amber-700',
  picked: 'bg-sky-100 text-sky-700', packed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700',
};

const kg = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });

// The pick sheet prints alone: no sidebar, header or on-screen controls.
const PRINT_CSS = `
.print-only { display: none; }
@media print {
  aside, header, .no-print { display: none !important; }
  .print-only { display: block !important; }
  html, body, main, .h-screen { height: auto !important; overflow: visible !important; background: #fff !important; }
  main { padding: 0 !important; }
  .pick-sheet, .pick-sheet * { color: #000 !important; }
  .pick-sheet tr { break-inside: avoid; }
  @page { size: portrait; margin: 10mm; }
}`;

const isDone = (l: Line) => (l.box_id ? !!l.box_scanned_at : !!l.bin_scanned_at);

export default function PickListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [pl, setPl] = useState<PickList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bin, setBin] = useState<{ id: string; code: string } | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => { api.get<PickList>(`/wms/pick-lists/${id}`).then(setPl).catch((e) => setError(e.message)); }, [id]);
  useEffect(() => { load(); }, [load]);

  const canPick = !!pl && ['draft', 'picking'].includes(pl.status);
  const lines = pl?.lines ?? [];
  const packLines = lines.filter((l) => l.box_id);
  const scannedPacks = packLines.filter((l) => l.box_scanned_at);
  const looseUnscanned = lines.filter((l) => !l.box_id && !l.bin_scanned_at);

  // Bin by bin, in walk order (the API sorts lines by bin code, then pack no.).
  const byBin = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of lines) (m.get(l.bin_code) ?? m.set(l.bin_code, []).get(l.bin_code)!).push(l);
    return [...m.entries()];
  }, [lines]);

  // Per item totals for the sheet footer.
  const byItem = useMemo(() => {
    const m = new Map<string, { name: string; uom: string; packs: number; heads: number; qty: number }>();
    for (const l of lines) {
      const k = `${l.sku} – ${l.item_name}`;
      const r = m.get(k) ?? { name: k, uom: l.uom, packs: 0, heads: 0, qty: 0 };
      r.packs += l.box_id ? 1 : 0; r.heads += Number(l.heads || 0); r.qty += Number(l.qty_to_pick);
      m.set(k, r);
    }
    return [...m.values()];
  }, [lines]);

  async function onScan(code: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.post<ScanResult>(`/wms/pick-lists/${id}/scan`, { code, bin_id: bin?.id ?? null });
      if (r.kind === 'bin' && r.bin_id) setBin({ id: r.bin_id, code: r.bin_code ?? '' });
      setFeedback({ ok: true, text: r.message });
      load();
    } catch (e) {
      setFeedback({ ok: false, text: (e as Error).message });
      try { navigator.vibrate?.([120, 60, 120]); } catch { /* not supported */ }
    } finally { setBusy(false); }
  }

  async function confirmPick() {
    const left = packLines.length - scannedPacks.length;
    if (left > 0 && !window.confirm(`${left} pack(s) were not scanned and will be left off this pick. Confirm the pick with ${scannedPacks.length} pack(s)?`)) return;
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

  const sheetQr = useMemo(() => (pl ? qrSvg(typeof window !== 'undefined' ? `${window.location.origin}/dashboard/wms/pick-lists/${pl.id}` : pl.pick_no, 84) : ''), [pl]);

  if (!pl) return <div className="text-sm text-slate-500">{error ?? 'Loading…'}</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <style>{PRINT_CSS}</style>

      {/* ── Screen ───────────────────────────────────────────── */}
      <div className="no-print">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">{pl.pick_no}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">{pl.warehouse_name}{pl.order_no ? ` · ${pl.order_no}${pl.customer_name ? ` (${pl.customer_name})` : ''}` : ''} · {formatDate(pl.created_at)}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[pl.status]}`}>{pl.status}</span>
            <button onClick={() => window.print()} className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Print pick list</button>
            {canPick && (
              <button onClick={confirmPick} disabled={busy || (packLines.length > 0 && !scannedPacks.length)}
 className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? '…' : 'Confirm pick'}</button>
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

        {canPick && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="text-slate-700 dark:text-slate-300">
                {bin ? <>Picking from bin <span className="font-mono font-semibold text-brand-700 dark:text-brand-400">{bin.code}</span> — scan each pack</> : <>Scan the <b>bin</b> label first, then each <b>pack</b> you take from it.</>}
              </div>
              <div className="tabular-nums text-slate-500">
                {packLines.length > 0 && <>{scannedPacks.length} / {packLines.length} packs scanned</>}
                {looseUnscanned.length > 0 && <span className="ml-2 text-amber-600">{looseUnscanned.length} loose line(s) need a bin scan</span>}
              </div>
            </div>
            <QrScanner onScan={onScan} busy={busy} autoFocus placeholder="Scan bin or pack label…" />
            {feedback && (
              <div className={`mt-2 rounded px-3 py-2 text-sm font-medium ${feedback.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-600 text-white'}`}>
                {feedback.text}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          {byBin.map(([code, ls]) => {
            const done = ls.filter(isDone).length;
            return (
              <div key={code} className={`overflow-hidden rounded-lg border ${bin?.code === code ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-200 dark:border-slate-700'}`}>
                <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-800">
                  <span>Bin <span className="font-mono font-semibold text-brand-700 dark:text-brand-400">{code}</span>{ls[0].bin_zone ? <span className="text-slate-500"> · {ls[0].bin_zone}</span> : null}</span>
                  <span className={`tabular-nums ${done === ls.length ? 'text-emerald-600' : 'text-slate-500'}`}>{done}/{ls.length}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {ls.map((l) => (
                      <tr key={l.id} className={`border-t border-slate-100 dark:border-slate-800 ${isDone(l) ? 'bg-emerald-50/60 dark:bg-emerald-900/10' : ''}`}>
                        <td className="w-8 px-3 py-1.5 text-center text-sm">{isDone(l) ? <span className="text-emerald-600">✓</span> : <span className="text-slate-300">○</span>}</td>
                        <td className="px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300">
                          {l.box_id && <span className="mr-1 font-mono text-slate-500">#{l.pack_no ?? '—'}</span>}
                          {l.item_name}
                          {l.batch_no && <span className="text-slate-500"> · {l.batch_no}</span>}
                          {!l.box_id && <span className="text-slate-500"> · loose{l.lot_no ? ` · lot ${l.lot_no}` : ''}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-500">{l.heads ? `${l.heads} hd` : ''}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-900 dark:text-slate-100">
                          {kg(l.qty_to_pick)} {l.uom}
                          {!canPick && l.qty_picked !== l.qty_to_pick && <span className="ml-1 text-amber-600">(picked {kg(l.qty_picked)})</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        {pl.notes && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Notes: {pl.notes}</p>}
      </div>

      {/* ── Printed pick sheet for the picker ────────────────── */}
      <div className="print-only pick-sheet text-[11px]">
        <div className="mb-2 flex items-start justify-between border-b-2 border-black pb-2">
          <div>
            <div className="text-lg font-bold tracking-wide">PICK LIST</div>
            <div className="font-mono text-base font-semibold">{pl.pick_no}</div>
            <table className="mt-1">
              <tbody>
                <tr><td className="pr-3 font-semibold">Sales order:</td><td>{pl.order_no ?? '—'}</td></tr>
                <tr><td className="pr-3 font-semibold">Customer:</td><td>{pl.customer_name ?? '—'}</td></tr>
                <tr><td className="pr-3 font-semibold">Delivery date:</td><td>{pl.delivery_date ? String(pl.delivery_date).slice(0, 10) : '—'}</td></tr>
                <tr><td className="pr-3 font-semibold">Warehouse:</td><td>{pl.warehouse_name}</td></tr>
                <tr><td className="pr-3 font-semibold">Prepared:</td><td>{formatDate(pl.created_at)}{pl.created_by_name ? ` by ${pl.created_by_name}` : ''}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="text-center">
            <div dangerouslySetInnerHTML={{ __html: sheetQr }} />
            <div className="text-[9px]">Scan to open on phone</div>
          </div>
        </div>
        <p className="mb-2 text-[10px]">Go bin by bin. Scan the bin label, then each pack's label. Tick each pack as it goes on the trolley.</p>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2">Bin</th><th className="py-1 pr-2">Pack</th><th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Batch / lot</th>
              <th className="py-1 pr-2 text-right">Heads</th><th className="py-1 pr-2 text-right">Kg</th><th className="w-10 py-1 text-center">✓</th>
            </tr>
          </thead>
          <tbody>
            {byBin.map(([code, ls]) => ls.map((l, i) => (
              <tr key={l.id} className={`border-b border-slate-300 ${i === 0 ? 'border-t border-t-black' : ''}`}>
                <td className="py-1 pr-2 font-mono font-semibold">{i === 0 ? code : ''}</td>
                <td className="py-1 pr-2 font-mono">{l.box_id ? `#${l.pack_no ?? '—'}` : 'loose'}</td>
                <td className="py-1 pr-2">{l.item_name}</td>
                <td className="py-1 pr-2">{l.batch_no ?? l.lot_no ?? ''}</td>
                <td className="py-1 pr-2 text-right">{l.heads || ''}</td>
                <td className="py-1 pr-2 text-right">{kg(l.qty_to_pick)}</td>
                <td className="py-1 text-center"><span className="inline-block h-3.5 w-3.5 border border-black" /></td>
              </tr>
            )))}
          </tbody>
        </table>

        <table className="mt-3 w-full border-collapse">
          <thead><tr className="border-b border-black text-left"><th className="py-1">Total per item</th><th className="py-1 text-right">Packs</th><th className="py-1 text-right">Heads</th><th className="py-1 text-right">Kg</th></tr></thead>
          <tbody>
            {byItem.map((r) => (
              <tr key={r.name} className="border-b border-slate-300">
                <td className="py-1">{r.name}</td><td className="py-1 text-right">{r.packs || ''}</td><td className="py-1 text-right">{r.heads || ''}</td><td className="py-1 text-right">{kg(r.qty)} {r.uom}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1">TOTAL</td>
              <td className="py-1 text-right">{byItem.reduce((a, r) => a + r.packs, 0) || ''}</td>
              <td className="py-1 text-right">{byItem.reduce((a, r) => a + r.heads, 0) || ''}</td>
              <td className="py-1 text-right">{kg(byItem.reduce((a, r) => a + r.qty, 0))}</td>
            </tr>
          </tbody>
        </table>
        {pl.notes && <p className="mt-2">Notes: {pl.notes}</p>}

        <div className="mt-8 grid grid-cols-3 gap-6 text-center">
          {['Picked by', 'Checked by', 'Date / time'].map((t) => (
            <div key={t}><div className="h-8 border-b border-black" /><div className="mt-1">{t}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}
