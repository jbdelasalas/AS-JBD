'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Warehouse { id: string; name: string; }
interface SoLine { item_id: string; sku: string; item_name: string; uom: string; ordered: number; open_qty: number; }
interface SalesOrder { id: string; order_no: string; customer_name: string; delivery_date: string | null; lines: SoLine[]; }
// Bin-stock rows carry the ids we need to pick against.
interface StockPick { bin_id: string; item_id: string; lot_id: string | null; bin_code: string; lot_no: string | null; expiry_date: string | null; last_movement_at: string | null; qty_on_hand: number; }
interface Line { item_id: string; key: string; qty_to_pick: string; }
// A pack/crate from a production put-away; picked whole.
interface Pack { id: string; item_id: string; bin_id: string; bin_code: string | null; lot_no: string | null; qty: number; heads: number; pack_no: number | null; batch_no: string | null; time_in: string; }

const keyOf = (s: StockPick) => `${s.item_id}|${s.bin_id}|${s.lot_id ?? ''}`;
const kg = (n: number) => (+n.toFixed(3)).toLocaleString(undefined, { maximumFractionDigits: 3 });

// Earliest expiry first, then the stock that has sat longest (FEFO, then FIFO).
function byPickOrder(a: StockPick, b: StockPick) {
  if (a.expiry_date !== b.expiry_date) {
    if (!a.expiry_date) return 1;
    if (!b.expiry_date) return -1;
    return a.expiry_date < b.expiry_date ? -1 : 1;
  }
  return (a.last_movement_at ?? '') < (b.last_movement_at ?? '') ? -1 : 1;
}

// Packs oldest first until the order line is covered — the last pack may take
// it a little over, since a pack goes whole.
function suggestPacks(so: SalesOrder, packs: Pack[]): Set<string> {
  const out = new Set<string>();
  for (const ol of so.lines) {
    let got = 0;
    for (const pk of packs.filter((x) => x.item_id === ol.item_id)) {
      if (got >= ol.open_qty - 1e-9) break;
      out.add(pk.id); got += pk.qty;
    }
  }
  return out;
}

// Loose stock in a bin = bin balance less the packs sitting in it.
function looseStock(stock: StockPick[], packs: Pack[]): StockPick[] {
  return stock.map((s) => {
    const inPacks = packs.filter((p) => p.item_id === s.item_id && p.bin_id === s.bin_id).reduce((a, p) => a + p.qty, 0);
    return { ...s, qty_on_hand: +(s.qty_on_hand - inPacks).toFixed(4) };
  }).filter((s) => s.qty_on_hand > 1e-9);
}

// Spread each order line's open qty over the bins holding that item. Items
// that come in packs are picked by pack instead.
function suggestLines(so: SalesOrder, stock: StockPick[], packs: Pack[]): Line[] {
  const out: Line[] = [];
  for (const ol of so.lines) {
    if (packs.some((p) => p.item_id === ol.item_id)) continue;
    let left = ol.open_qty;
    for (const s of stock.filter((x) => x.item_id === ol.item_id).sort(byPickOrder)) {
      if (left <= 0) break;
      const take = Math.min(left, s.qty_on_hand);
      if (take <= 0) continue;
      out.push({ item_id: ol.item_id, key: keyOf(s), qty_to_pick: String(+take.toFixed(4)) });
      left -= take;
    }
    if (left > 1e-9 || !out.some((l) => l.item_id === ol.item_id)) out.push({ item_id: ol.item_id, key: '', qty_to_pick: left > 0 ? String(+left.toFixed(4)) : '' });
  }
  return out;
}

export default function NewPickListPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [soId, setSoId] = useState('');
  const [stock, setStock] = useState<StockPick[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: Warehouse[] }>(`/wms/warehouses?company_id=${companyId}`).then((r) => setWarehouses(r.data)).catch(() => {});
  }, [companyId]);

  const loadForWarehouse = useCallback((wh: string) => {
    if (!companyId || !wh) { setStock([]); setOrders([]); setPacks([]); return; }
    api.get<StockPick[]>(`/wms/stock-on-hand?company_id=${companyId}&warehouse_id=${wh}&hide_zero=true`).then(setStock).catch(() => {});
    api.get<Pack[]>(`/wms/packs-to-pick?company_id=${companyId}&warehouse_id=${wh}`).then(setPacks).catch(() => {});
    api.get<SalesOrder[]>(`/wms/sales-orders-to-pick?company_id=${companyId}&warehouse_id=${wh}`).then(setOrders).catch(() => {});
  }, [companyId]);

  useEffect(() => { loadForWarehouse(warehouseId); setSoId(''); setLines([]); setChosen(new Set()); }, [warehouseId, loadForWarehouse]);

  const loose = looseStock(stock, packs);
  const so = orders.find((o) => o.id === soId);
  const soLine = (itemId: string) => so?.lines.find((l) => l.item_id === itemId);
  const packsOf = (itemId: string) => packs.filter((p) => p.item_id === itemId);
  const chosenOf = (itemId: string) => packsOf(itemId).filter((p) => chosen.has(p.id));

  function pickOrder(id: string) {
    setSoId(id);
    const o = orders.find((x) => x.id === id);
    setLines(o ? suggestLines(o, loose, packs) : []);
    setChosen(o ? suggestPacks(o, packs) : new Set());
  }

  const togglePack = (id: string) => setChosen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setItemPacks = (itemId: string, on: boolean) => setChosen((p) => {
    const n = new Set(p);
    for (const pk of packs) if (pk.item_id === itemId) { if (on) n.add(pk.id); else n.delete(pk.id); }
    return n;
  });
  const setLine = (i: number, field: keyof Line, v: string) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, [field]: v } : l));
  const removeLine = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i));
  // Another bin for the same order line (split the pick).
  const splitLine = (i: number) => setLines((p) => [...p.slice(0, i + 1), { item_id: p[i].item_id, key: '', qty_to_pick: '' }, ...p.slice(i + 1)]);
  const addLoose = (itemId: string) => setLines((p) => [...p, { item_id: itemId, key: '', qty_to_pick: '' }]);

  const pickedFor = (itemId: string) => lines.filter((l) => l.item_id === itemId).reduce((a, l) => a + Number(l.qty_to_pick || 0), 0)
    + chosenOf(itemId).reduce((a, p) => a + p.qty, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId || !warehouseId) { setError('Select a warehouse'); return; }
    if (!so) { setError('Select a sales order'); return; }
    const valid = lines.filter((l) => l.key && Number(l.qty_to_pick) > 0);
    const packIds = packs.filter((p) => chosen.has(p.id) && so.lines.some((ol) => ol.item_id === p.item_id)).map((p) => p.id);
    if (!valid.length && !packIds.length) { setError('Choose packs, or give each line a bin and a positive qty'); return; }
    // Packs go whole: over is fine while dropping any one pack would leave it short.
    const over = so.lines.find((ol) => {
      const c = chosenOf(ol.item_id);
      const slack = c.length ? Math.min(...c.map((p) => p.qty)) - 1e-6 : 1e-9;
      return pickedFor(ol.item_id) > ol.open_qty + slack;
    });
    if (over) { setError(`${over.item_name}: picking ${kg(pickedFor(over.item_id))} but only ${over.open_qty} is open on the order — take off a pack or lower the qty`); return; }

    setSaving(true);
    try {
      const res = await api.post<{ id: string }>('/wms/pick-lists', {
        company_id: companyId, warehouse_id: warehouseId, so_id: so.id, notes: notes || null,
        lines: [
          ...packIds.map((box_id) => ({ box_id })),
          ...valid.map((l) => {
            const [item_id, bin_id, lot_id] = l.key.split('|');
            return { item_id, bin_id, lot_id: lot_id || null, qty_to_pick: Number(l.qty_to_pick) };
          }),
        ],
      });
      router.push(`/dashboard/wms/pick-lists/${res.id}`);
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }

  const inputCls = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">New Pick List</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Pick for an approved sales order. Production output is picked by pack/crate, oldest first; other stock by bin,
          earliest expiry first. Change the suggestion if needed — the picker then scans each bin and pack.
        </p>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Warehouse *</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required className={inputCls}>
                <option value="">Select…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Sales Order *</label>
              <select value={soId} onChange={(e) => pickOrder(e.target.value)} disabled={!warehouseId} className={`${inputCls} disabled:opacity-50`}>
                <option value="">{warehouseId && !orders.length ? '— no approved orders left to pick —' : 'Select…'}</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_no} · {o.customer_name}{o.delivery_date ? ` · deliver ${String(o.delivery_date).slice(0, 10)}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        {so && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">Lines — {so.order_no}</h2>

            {so.lines.filter((ol) => packsOf(ol.item_id).length > 0).map((ol) => {
              const list = packsOf(ol.item_id);
              const c = chosenOf(ol.item_id);
              const got = pickedFor(ol.item_id);
              const diff = got - ol.open_qty;
              return (
                <div key={ol.item_id} className="mb-4 rounded border border-slate-200 dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{ol.sku} – {ol.item_name}</span>
                      <span className="text-slate-500"> · open {kg(ol.open_qty)} {ol.uom}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums text-slate-700 dark:text-slate-300">
                        {c.length} of {list.length} packs · {kg(got)} {ol.uom}
                        {Math.abs(diff) > 1e-6 && <span className={diff < 0 ? 'text-amber-600' : 'text-sky-600'}> ({diff < 0 ? 'short' : 'over'} {kg(Math.abs(diff))})</span>}
                      </span>
                      <button type="button" onClick={() => setItemPacks(ol.item_id, c.length < list.length)} className="text-brand-600 hover:underline">
                        {c.length < list.length ? 'All' : 'None'}
                      </button>
                      <button type="button" onClick={() => addLoose(ol.item_id)} className="text-brand-600 hover:underline">+ loose stock</button>
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white text-slate-500 dark:bg-slate-900">
                        <tr>
                          <th className="w-8 px-3 py-1" /><th className="px-2 py-1 text-left">Pack</th><th className="px-2 py-1 text-left">Batch</th>
                          <th className="px-2 py-1 text-left">Bin</th><th className="px-2 py-1 text-right">Heads</th><th className="px-3 py-1 text-right">Kg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((pk) => (
                          <tr key={pk.id} onClick={() => togglePack(pk.id)}
                            className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 ${chosen.has(pk.id) ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}>
                            <td className="px-3 py-1"><input type="checkbox" checked={chosen.has(pk.id)} onChange={() => togglePack(pk.id)} onClick={(e) => e.stopPropagation()} /></td>
                            <td className="px-2 py-1 font-mono">#{pk.pack_no ?? '—'}</td>
                            <td className="px-2 py-1 text-slate-600 dark:text-slate-400">{pk.batch_no}</td>
                            <td className="px-2 py-1 font-mono text-brand-700 dark:text-brand-400">{pk.bin_code}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{pk.heads || ''}</td>
                            <td className="px-3 py-1 text-right tabular-nums">{kg(pk.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            <div className="space-y-2">
              {lines.length > 0 && (
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <div className="col-span-4">Item (open on order)</div><div className="col-span-5">Bin / lot</div>
                  <div className="col-span-2">Qty to pick</div><div className="col-span-1" />
                </div>
              )}
              {lines.map((l, i) => {
                const ol = soLine(l.item_id);
                const bins = loose.filter((s) => s.item_id === l.item_id).sort(byPickOrder);
                const packed = packsOf(l.item_id).length > 0;
                const first = lines.findIndex((x) => x.item_id === l.item_id) === i;
                const short = first && !packed && ol && pickedFor(l.item_id) < ol.open_qty - 1e-9;
                return (
                  <div key={i} className="grid grid-cols-12 items-center gap-2">
                    <div className="col-span-4 text-xs text-slate-800 dark:text-slate-200">
                      {first ? <>
                        <span className="font-medium">{ol?.sku} – {ol?.item_name}</span>
                        <span className="text-slate-500"> ({ol?.open_qty} {ol?.uom})</span>
                        {packed && <div className="text-[11px] text-slate-500">loose stock (not in packs)</div>}
                        {short && <div className="text-[11px] text-amber-600">Short {+(ol!.open_qty - pickedFor(l.item_id)).toFixed(4)} {ol!.uom} — not enough in bins</div>}
                      </> : <span className="pl-3 text-slate-400">↳ another bin</span>}
                    </div>
                    <div className="col-span-5">
                      <select value={l.key} onChange={(e) => setLine(i, 'key', e.target.value)}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        <option value="">{bins.length ? 'Select bin…' : 'No loose stock in this warehouse'}</option>
                        {bins.map((s) => (
                          <option key={keyOf(s)} value={keyOf(s)}>
                            {s.bin_code}{s.lot_no ? ` · lot ${s.lot_no}` : ''}{s.expiry_date ? ` · exp ${String(s.expiry_date).slice(0, 10)}` : ''} (avail {s.qty_on_hand})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <input type="number" step="0.0001" min="0" value={l.qty_to_pick} onChange={(e) => setLine(i, 'qty_to_pick', e.target.value)} placeholder="0"
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </div>
                    <div className="col-span-1 flex items-center gap-2">
                      <button type="button" onClick={() => splitLine(i)} title="Pick part from another bin" className="text-xs text-brand-600 hover:underline">+bin</button>
                      {(!first || packed) && <button type="button" onClick={() => removeLine(i)} className="text-xs text-red-500 hover:text-red-700">✕</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => router.back()} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving || !so} className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Create pick list'}</button>
        </div>
      </form>
    </div>
  );
}
