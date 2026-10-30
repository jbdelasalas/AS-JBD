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

const keyOf = (s: StockPick) => `${s.item_id}|${s.bin_id}|${s.lot_id ?? ''}`;

// Earliest expiry first, then the stock that has sat longest (FEFO, then FIFO).
function byPickOrder(a: StockPick, b: StockPick) {
  if (a.expiry_date !== b.expiry_date) {
    if (!a.expiry_date) return 1;
    if (!b.expiry_date) return -1;
    return a.expiry_date < b.expiry_date ? -1 : 1;
  }
  return (a.last_movement_at ?? '') < (b.last_movement_at ?? '') ? -1 : 1;
}

// Spread each order line's open qty over the bins holding that item.
function suggestLines(so: SalesOrder, stock: StockPick[]): Line[] {
  const out: Line[] = [];
  for (const ol of so.lines) {
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
    if (!companyId || !wh) { setStock([]); setOrders([]); return; }
    api.get<StockPick[]>(`/wms/stock-on-hand?company_id=${companyId}&warehouse_id=${wh}&hide_zero=true`).then(setStock).catch(() => {});
    api.get<SalesOrder[]>(`/wms/sales-orders-to-pick?company_id=${companyId}&warehouse_id=${wh}`).then(setOrders).catch(() => {});
  }, [companyId]);

  useEffect(() => { loadForWarehouse(warehouseId); setSoId(''); setLines([]); }, [warehouseId, loadForWarehouse]);

  const so = orders.find((o) => o.id === soId);
  const soLine = (itemId: string) => so?.lines.find((l) => l.item_id === itemId);

  function pickOrder(id: string) {
    setSoId(id);
    const o = orders.find((x) => x.id === id);
    setLines(o ? suggestLines(o, stock) : []);
  }

  const setLine = (i: number, field: keyof Line, v: string) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, [field]: v } : l));
  const removeLine = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i));
  // Another bin for the same order line (split the pick).
  const splitLine = (i: number) => setLines((p) => [...p.slice(0, i + 1), { item_id: p[i].item_id, key: '', qty_to_pick: '' }, ...p.slice(i + 1)]);

  const pickedFor = (itemId: string) => lines.filter((l) => l.item_id === itemId).reduce((a, l) => a + Number(l.qty_to_pick || 0), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId || !warehouseId) { setError('Select a warehouse'); return; }
    if (!so) { setError('Select a sales order'); return; }
    const valid = lines.filter((l) => l.key && Number(l.qty_to_pick) > 0);
    if (!valid.length) { setError('Each line needs a bin and a positive qty'); return; }
    const over = so.lines.find((ol) => pickedFor(ol.item_id) > ol.open_qty + 1e-9);
    if (over) { setError(`${over.item_name}: picking ${pickedFor(over.item_id)} but only ${over.open_qty} is open on the order`); return; }

    setSaving(true);
    try {
      const res = await api.post<{ id: string }>('/wms/pick-lists', {
        company_id: companyId, warehouse_id: warehouseId, so_id: so.id, notes: notes || null,
        lines: valid.map((l) => {
          const [item_id, bin_id, lot_id] = l.key.split('|');
          return { item_id, bin_id, lot_id: lot_id || null, qty_to_pick: Number(l.qty_to_pick) };
        }),
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
          Pick for an approved sales order. Bins are suggested earliest-expiry first, then oldest stock; change them if needed.
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
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                <div className="col-span-4">Item (open on order)</div><div className="col-span-5">Bin / lot</div>
                <div className="col-span-2">Qty to pick</div><div className="col-span-1" />
              </div>
              {lines.map((l, i) => {
                const ol = soLine(l.item_id);
                const bins = stock.filter((s) => s.item_id === l.item_id).sort(byPickOrder);
                const first = lines.findIndex((x) => x.item_id === l.item_id) === i;
                const short = first && ol && pickedFor(l.item_id) < ol.open_qty - 1e-9;
                return (
                  <div key={i} className="grid grid-cols-12 items-center gap-2">
                    <div className="col-span-4 text-xs text-slate-800 dark:text-slate-200">
                      {first ? <>
                        <span className="font-medium">{ol?.sku} – {ol?.item_name}</span>
                        <span className="text-slate-500"> ({ol?.open_qty} {ol?.uom})</span>
                        {short && <div className="text-[11px] text-amber-600">Short {+(ol!.open_qty - pickedFor(l.item_id)).toFixed(4)} {ol!.uom} — not enough in bins</div>}
                      </> : <span className="pl-3 text-slate-400">↳ another bin</span>}
                    </div>
                    <div className="col-span-5">
                      <select value={l.key} onChange={(e) => setLine(i, 'key', e.target.value)}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        <option value="">{bins.length ? 'Select bin…' : 'No stock in this warehouse'}</option>
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
                      {!first && <button type="button" onClick={() => removeLine(i)} className="text-xs text-red-500 hover:text-red-700">✕</button>}
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
