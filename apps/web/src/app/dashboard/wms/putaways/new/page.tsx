'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Warehouse { id: string; name: string; }
interface Bin { id: string; code: string; warehouse_id: string; }
type SourceLine = { item_id: string; sku: string; item_name: string; uom: string; tracking_mode: string; qty: number; unit_cost: number };
interface Grn { id: string; grn_no: string; warehouse_id: string; lines: SourceLine[]; }
interface Transfer { id: string; transfer_no: string; from_warehouse_name: string; lines: SourceLine[]; }
type Source = 'grn' | 'transfer';
interface Line { item_id: string; bin_id: string; lot_no: string; qty: string; unit_cost: string; tracking_mode: string; }

const blank: Line = { item_id: '', bin_id: '', lot_no: '', qty: '', unit_cost: '0', tracking_mode: 'none' };

export default function NewPutawayPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [bins, setBins] = useState<Bin[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [source, setSource] = useState<Source>('grn');
  const [docId, setDocId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...blank }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: Warehouse[] }>(`/wms/warehouses?company_id=${companyId}`).then((r) => setWarehouses(r.data)).catch(() => {});
  }, [companyId]);

  const loadForWarehouse = useCallback((wh: string) => {
    if (!companyId || !wh) { setBins([]); setGrns([]); setTransfers([]); return; }
    api.get<{ data: Bin[] }>(`/wms/bins?company_id=${companyId}&warehouse_id=${wh}&active=true`).then((r) => setBins(r.data)).catch(() => {});
    api.get<Grn[]>(`/wms/goods-receipts?company_id=${companyId}&warehouse_id=${wh}`).then(setGrns).catch(() => {});
    api.get<Transfer[]>(`/wms/stock-transfers?company_id=${companyId}&warehouse_id=${wh}`).then(setTransfers).catch(() => {});
  }, [companyId]);

  useEffect(() => { loadForWarehouse(warehouseId); setDocId(''); }, [warehouseId, loadForWarehouse]);

  const docs = source === 'grn'
    ? grns.map((g) => ({ id: g.id, label: g.grn_no, lines: g.lines }))
    : transfers.map((t) => ({ id: t.id, label: `${t.transfer_no} · from ${t.from_warehouse_name}`, lines: t.lines }));
  // Lines can only use items on the chosen document (add a line to split one item across bins).
  const docLines = docs.find((d) => d.id === docId)?.lines ?? [];

  function pickSource(s: Source) {
    setSource(s);
    setDocId('');
    setLines([{ ...blank }]);
  }

  // When a goods receipt or transfer is chosen, pre-fill lines from it.
  function pickDoc(id: string) {
    setDocId(id);
    const doc = docs.find((d) => d.id === id);
    if (!doc) { setLines([{ ...blank }]); return; }
    setLines(doc.lines.map((l) => ({
      item_id: l.item_id, bin_id: '', lot_no: '', qty: String(l.qty),
      unit_cost: String(l.unit_cost), tracking_mode: l.tracking_mode ?? 'none',
    })));
  }

  function setLine(i: number, field: keyof Line, value: string) {
    setLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, [field]: value };
      if (field === 'item_id') next.tracking_mode = docLines.find((dl) => dl.item_id === value)?.tracking_mode ?? 'none';
      return next;
    }));
  }
  const addLine = () => setLines((p) => [...p, { ...blank }]);
  const removeLine = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId || !warehouseId) { setError('Select a warehouse'); return; }
    if (!docId) { setError(source === 'grn' ? 'Select a goods receipt' : 'Select a transfer'); return; }
    const valid = lines.filter((l) => l.item_id && l.bin_id && Number(l.qty) > 0);
    if (!valid.length) { setError('Each line needs an item, a bin, and a positive qty'); return; }

    setSaving(true);
    try {
      const res = await api.post<{ id: string }>('/wms/putaways', {
        company_id: companyId, warehouse_id: warehouseId, notes: notes || null,
        grn_id: source === 'grn' ? docId : null,
        transfer_id: source === 'transfer' ? docId : null,
        lines: valid.map((l) => ({ item_id: l.item_id, bin_id: l.bin_id, lot_no: l.lot_no || null, qty: Number(l.qty), unit_cost: Number(l.unit_cost) })),
      });
      router.push(`/dashboard/wms/putaways/${res.id}`);
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }


  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">New Put-away</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Assign received goods to bins — from a supplier goods receipt or a stock transfer from another warehouse.</p>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Warehouse *</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Source *</label>
              <select value={source} onChange={(e) => pickSource(e.target.value as Source)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="grn">Goods Receipt (supplier)</option>
                <option value="transfer">Stock Transfer (other warehouse)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">{source === 'grn' ? 'Goods Receipt *' : 'Transfer *'}</label>
              <select value={docId} onChange={(e) => pickDoc(e.target.value)} disabled={!warehouseId}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">{warehouseId && !docs.length ? '— nothing left to put away —' : 'Select…'}</option>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Lines</h2>
            <button type="button" onClick={addLine} className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <div className="col-span-4">Item</div><div className="col-span-3">Bin</div>
              <div className="col-span-2">Lot</div><div className="col-span-2">Qty</div><div className="col-span-1" />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <div className="col-span-4">
                  <select value={l.item_id} onChange={(e) => setLine(i, 'item_id', e.target.value)} disabled={!docId}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    <option value="">{docId ? 'Select…' : 'Pick a document first'}</option>
                    {docLines.map((dl) => <option key={dl.item_id} value={dl.item_id}>{dl.sku} – {dl.item_name} ({dl.qty} {dl.uom} left)</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <select value={l.bin_id} onChange={(e) => setLine(i, 'bin_id', e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    <option value="">Select bin…</option>
                    {bins.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <input value={l.lot_no} onChange={(e) => setLine(i, 'lot_no', e.target.value)}
                    placeholder={l.tracking_mode === 'lot' ? 'Lot *' : 'Lot'}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                </div>
                <div className="col-span-2">
                  <input type="number" step="0.0001" min="0.0001" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} placeholder="0"
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                </div>
                <div className="col-span-1 flex items-center">
                  {lines.length > 1 && <button type="button" onClick={() => removeLine(i)} className="text-xs text-red-500 hover:text-red-700">✕</button>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => router.back()} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Create put-away'}</button>
        </div>
      </form>
    </div>
  );
}
