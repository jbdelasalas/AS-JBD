'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Warehouse { id: string; name: string; code: string; }
interface ItemOption { id: string; sku: string; name: string; uom: string; standard_cost: number; }

const REASON_CODES = ['DAMAGE','SPOILAGE','THEFT','FOUND','COUNT_CORRECTION','RECLASSIFICATION','OTHER'] as const;

interface Line { item_id: string; qty_change: string; unit_cost: string; notes: string; }

export default function NewAdjustmentPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [reasonCode, setReasonCode] = useState<string>('DAMAGE');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ item_id: '', qty_change: '', unit_cost: '', notes: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<unknown[]>(`/purchasing/suppliers?company_id=${companyId}&limit=500`).catch(() => []),
      api.get<ItemOption[]>(`/inventory/items?company_id=${companyId}&limit=500`),
      fetch(`/api/v1/purchasing/purchase-orders?company_id=${companyId}&limit=1`)
        .then(() => null).catch(() => null),
    ]);
    // Load warehouses via direct fetch (no dedicated API wrapper needed)
    fetch(`/api/v1/inventory/stock-on-hand?company_id=${companyId}&limit=1`)
      .then((r) => r.json())
      .catch(() => ({ data: [] }));

    // For warehouses, use a simple fetch
    fetch(`/api/v1/inventory/items?company_id=${companyId}&limit=1`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token') ?? ''}` },
    }).catch(() => {});

    api.get<ItemOption[]>(`/inventory/items?company_id=${companyId}&limit=500`)
      .then((r) => setItems(r))
      .catch(() => {});

    // Fetch warehouses from stock-on-hand distinct list
    fetch(`/api/v1/inventory/stock-on-hand?company_id=${companyId}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token') ?? ''}` },
    }).then((r) => r.json()).then((res) => {
      const data = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
      const seen = new Set<string>();
      const whs: Warehouse[] = [];
      for (const row of data as Array<{ warehouse_id: string; warehouse_name: string }>) {
        if (!seen.has(row.warehouse_id)) {
          seen.add(row.warehouse_id);
          whs.push({ id: row.warehouse_id, name: row.warehouse_name, code: '' });
        }
      }
      setWarehouses(whs);
    }).catch(() => {});
  }, []);

  function setLine(i: number, field: keyof Line, value: string) {
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  }

  function addLine() { setLines((prev) => [...prev, { item_id: '', qty_change: '', unit_cost: '', notes: '' }]); }
  function removeLine(i: number) { setLines((prev) => prev.filter((_, idx) => idx !== i)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    if (!warehouseId) { setError('Select a warehouse'); return; }
    const validLines = lines.filter((l) => l.item_id && l.qty_change);
    if (!validLines.length) { setError('At least one item line required'); return; }

    setSaving(true);
    try {
      const res = await api.post<{ id: string }>('/inventory/adjustments', {
        company_id: companyId,
        warehouse_id: warehouseId,
        reason_code: reasonCode,
        notes: notes || null,
        lines: validLines.map((l) => ({
          item_id: l.item_id,
          qty_change: Number(l.qty_change),
          unit_cost: Number(l.unit_cost || 0),
          notes: l.notes || null,
        })),
      });
      router.push(`/dashboard/inventory/adjustments/${res.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">New Stock Adjustment</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Record inventory gains or losses.</p>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">Header</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Warehouse *</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select warehouse…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Reason *</label>
              <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} required
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                {REASON_CODES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Lines</h2>
            <button type="button" onClick={addLine}
              className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <div className="col-span-4">Item</div>
              <div className="col-span-3">Qty Change (+/-)</div>
              <div className="col-span-2">Unit Cost</div>
              <div className="col-span-2">Notes</div>
              <div className="col-span-1" />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <div className="col-span-4">
                  <select value={l.item_id} onChange={(e) => {
                    const item = items.find((it) => it.id === e.target.value);
                    setLine(i, 'item_id', e.target.value);
                    if (item && !l.unit_cost) setLine(i, 'unit_cost', String(item.standard_cost));
                  }}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    <option value="">Select item…</option>
                    {items.map((it) => <option key={it.id} value={it.id}>{it.sku} – {it.name}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <input type="number" step="0.0001" placeholder="e.g. -5 or +3"
                    value={l.qty_change} onChange={(e) => setLine(i, 'qty_change', e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                </div>
                <div className="col-span-2">
                  <input type="number" step="0.0001" min="0" placeholder="0.00"
                    value={l.unit_cost} onChange={(e) => setLine(i, 'unit_cost', e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                </div>
                <div className="col-span-2">
                  <input type="text" placeholder="optional"
                    value={l.notes} onChange={(e) => setLine(i, 'notes', e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                </div>
                <div className="col-span-1 flex items-center">
                  {lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(i)}
                      className="text-red-500 hover:text-red-700 text-xs">✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </form>
    </div>
  );
}
