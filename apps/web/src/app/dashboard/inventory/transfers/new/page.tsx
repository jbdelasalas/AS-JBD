'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Warehouse { id: string; name: string; }
interface ItemOption { id: string; sku: string; name: string; uom: string; }
interface Line { item_id: string; qty: string; }

export default function NewTransferPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ item_id: '', qty: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    const token = localStorage.getItem('token') ?? '';
    if (!companyId) return;

    // Get distinct warehouses from SOH
    fetch(`/api/v1/inventory/stock-on-hand?company_id=${companyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json()).then((res) => {
      const data: Array<{ warehouse_id: string; warehouse_name: string }> =
        Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : [];
      const seen = new Set<string>();
      const whs: Warehouse[] = [];
      for (const row of data) {
        if (!seen.has(row.warehouse_id)) {
          seen.add(row.warehouse_id);
          whs.push({ id: row.warehouse_id, name: row.warehouse_name });
        }
      }
      setWarehouses(whs);
    }).catch(() => {});

    api.get<ItemOption[]>(`/inventory/items?company_id=${companyId}&limit=500`)
      .then(setItems).catch(() => {});
  }, []);

  function setLine(i: number, field: keyof Line, value: string) {
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  }
  function addLine() { setLines((prev) => [...prev, { item_id: '', qty: '' }]); }
  function removeLine(i: number) { setLines((prev) => prev.filter((_, idx) => idx !== i)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    if (!fromWarehouseId || !toWarehouseId) { setError('Select both warehouses'); return; }
    if (fromWarehouseId === toWarehouseId) { setError('From and To must be different warehouses'); return; }
    const validLines = lines.filter((l) => l.item_id && Number(l.qty) > 0);
    if (!validLines.length) { setError('At least one item line with positive qty required'); return; }

    setSaving(true);
    try {
      const res = await api.post<{ id: string }>('/inventory/transfers', {
        company_id: companyId,
        from_warehouse_id: fromWarehouseId,
        to_warehouse_id: toWarehouseId,
        notes: notes || null,
        lines: validLines.map((l) => ({ item_id: l.item_id, qty: Number(l.qty) })),
      });
      router.push(`/dashboard/inventory/transfers/${res.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">New Stock Transfer</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Move inventory between warehouses.</p>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">Header</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">From Warehouse *</label>
              <select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)} required
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">To Warehouse *</label>
              <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} required
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select…</option>
                {warehouses.filter((w) => w.id !== fromWarehouseId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
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
            <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Items to Transfer</h2>
            <button type="button" onClick={addLine} className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <div className="col-span-8">Item</div>
              <div className="col-span-3">Qty</div>
              <div className="col-span-1" />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <div className="col-span-8">
                  <select value={l.item_id} onChange={(e) => setLine(i, 'item_id', e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    <option value="">Select item…</option>
                    {items.map((it) => <option key={it.id} value={it.id}>{it.sku} – {it.name} ({it.uom})</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <input type="number" step="0.0001" min="0.0001" placeholder="0"
                    value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)}
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
            {saving ? 'Saving…' : 'Create transfer'}
          </button>
        </div>
      </form>
    </div>
  );
}
