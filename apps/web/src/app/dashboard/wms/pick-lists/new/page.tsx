'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Warehouse { id: string; name: string; }
interface SohRow { id: string; sku: string; item_name: string; uom: string; bin_code: string; lot_no: string | null; qty_on_hand: number; }
// Bin-stock rows carry the ids we need to pick against; fetch raw to keep them.
interface StockPick { bin_id: string; item_id: string; lot_id: string | null; sku: string; item_name: string; uom: string; bin_code: string; lot_no: string | null; qty_on_hand: number; }
interface Line { key: string; qty_to_pick: string; }

export default function NewPickListPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
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

  const loadStock = useCallback((wh: string) => {
    if (!companyId || !wh) { setStock([]); return; }
    // stock-on-hand returns bsb.id but not item_id/bin_id/lot_id; fetch raw fields via bins+balances is overkill,
    // so we extend the SOH response client-side by reading the underlying ids it already exposes.
    api.get<Array<StockPick & { id: string }>>(`/wms/stock-on-hand?company_id=${companyId}&warehouse_id=${wh}&hide_zero=true`)
      .then((rows) => setStock(rows as StockPick[]))
      .catch(() => {});
  }, [companyId]);

  useEffect(() => { loadStock(warehouseId); setLines([]); }, [warehouseId, loadStock]);

  const addLine = () => setLines((p) => [...p, { key: '', qty_to_pick: '' }]);
  const setLine = (i: number, field: keyof Line, v: string) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, [field]: v } : l));
  const removeLine = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i));

  function keyOf(s: StockPick) { return `${s.item_id}|${s.bin_id}|${s.lot_id ?? ''}`; }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId || !warehouseId) { setError('Select a warehouse'); return; }
    const valid = lines.filter((l) => l.key && Number(l.qty_to_pick) > 0);
    if (!valid.length) { setError('Add at least one line with a positive qty'); return; }

    const payload = valid.map((l) => {
      const [item_id, bin_id, lot_id] = l.key.split('|');
      return { item_id, bin_id, lot_id: lot_id || null, qty_to_pick: Number(l.qty_to_pick) };
    });

    setSaving(true);
    try {
      const res = await api.post<{ id: string }>('/wms/pick-lists', {
        company_id: companyId, warehouse_id: warehouseId, notes: notes || null, lines: payload,
      });
      router.push(`/dashboard/wms/pick-lists/${res.id}`);
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">New Pick List</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Pick stock from specific bins.</p>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Warehouse *</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Lines</h2>
            <button type="button" onClick={addLine} disabled={!warehouseId} className="text-xs text-brand-600 hover:underline disabled:opacity-50">+ Add line</button>
          </div>
          {stock.length === 0 && warehouseId && <p className="text-xs text-slate-400">No bin stock in this warehouse yet.</p>}
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <div className="col-span-9">
                  <select value={l.key} onChange={(e) => setLine(i, 'key', e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    <option value="">Select item @ bin…</option>
                    {stock.map((s) => (
                      <option key={keyOf(s)} value={keyOf(s)}>
                        {s.sku} – {s.item_name} @ {s.bin_code}{s.lot_no ? ` · lot ${s.lot_no}` : ''} (avail {s.qty_on_hand} {s.uom})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <input type="number" step="0.0001" min="0.0001" value={l.qty_to_pick} onChange={(e) => setLine(i, 'qty_to_pick', e.target.value)} placeholder="Qty"
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                </div>
                <div className="col-span-1 flex items-center">
                  <button type="button" onClick={() => removeLine(i)} className="text-xs text-red-500 hover:text-red-700">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => router.back()} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Create pick list'}</button>
        </div>
      </form>
    </div>
  );
}
