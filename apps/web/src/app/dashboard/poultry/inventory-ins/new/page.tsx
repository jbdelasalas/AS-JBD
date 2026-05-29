'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { api } from '@/lib/api';

interface Supplier { id: string; code: string; name: string; }
interface Item { id: string; sku: string; name: string; standard_cost: number; }
interface Warehouse { id: string; code: string; name: string; }
interface Line { item_id: string; batch_no: string; quantity_received: number; quantity_doa: number; unit_cost: number; remarks: string; }

function NewInventoryInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ supplier_id: '', warehouse_id: '', transaction_date: new Date().toISOString().split('T')[0], delivery_method: '', contact_person: '', remarks: '', notes: '', order_in_id: params.get('order_in_id') ?? '' });
  const [lines, setLines] = useState<Line[]>([{ item_id: '', batch_no: '', quantity_received: 1, quantity_doa: 0, unit_cost: 0, remarks: '' }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${cid}&limit=200`).then(r => setSuppliers(r.data)).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=500`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Warehouse[]>(`/inventory/warehouses?company_id=${cid}`).then(r => setWarehouses(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  function updateLine(i: number, f: keyof Line, v: string | number) {
    setLines(prev => { const n = [...prev]; const l = { ...n[i] };
      if (f === 'item_id') { const it = items.find(x => x.id === v); l.item_id = v as string; if (it) l.unit_cost = it.standard_cost; }
      else (l as Record<string, unknown>)[f] = v;
      n[i] = l; return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.supplier_id) { setError('Select a supplier'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const rec = await api.post<{ id: string }>('/poultry/inventory-ins', { company_id: cid, ...form, lines });
      router.push(`/dashboard/poultry/inventory-ins/${rec.id}`);
    } catch (e: unknown) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Inventory In</h1>
      <p className="mb-5 text-sm text-slate-500">Receive chicks into inventory.</p>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Receipt Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Supplier *</label>
              <select required value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select supplier…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Receipt Date *</label>
              <input required type="date" value={form.transaction_date} onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Warehouse</label>
              <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select warehouse…</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Delivery Method</label>
              <input type="text" value={form.delivery_method} onChange={e => setForm(f => ({ ...f, delivery_method: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Contact Person</label>
              <input type="text" value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Remarks</label>
              <textarea rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Line Items</div>
            <button type="button" onClick={() => setLines(l => [...l, { item_id: '', batch_no: '', quantity_received: 1, quantity_doa: 0, unit_cost: 0, remarks: '' }])} className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left w-48">Item</th>
                <th className="px-2 py-1.5 text-left w-28">Batch No.</th>
                <th className="px-2 py-1.5 text-right w-24">Qty Received</th>
                <th className="px-2 py-1.5 text-right w-20">DOA</th>
                <th className="px-2 py-1.5 text-right w-20">Net</th>
                <th className="px-2 py-1.5 text-right w-24">Unit Cost</th>
                <th className="px-2 py-1.5 text-left">Remarks</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-2 py-1">
                    <select value={l.item_id} onChange={e => updateLine(i, 'item_id', e.target.value)} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="">Select item…</option>
                      {items.map(it => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1"><input type="text" placeholder="Auto if blank" value={l.batch_no} onChange={e => updateLine(i, 'batch_no', e.target.value)} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="number" min={0} value={l.quantity_received} onChange={e => updateLine(i, 'quantity_received', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="number" min={0} value={l.quantity_doa} onChange={e => updateLine(i, 'quantity_doa', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1 text-right font-mono text-slate-600">{(l.quantity_received - l.quantity_doa).toLocaleString()}</td>
                  <td className="px-2 py-1"><input type="number" min={0} step="any" value={l.unit_cost} onChange={e => updateLine(i, 'unit_cost', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="text" value={l.remarks} onChange={e => updateLine(i, 'remarks', e.target.value)} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-1 text-center">{lines.length > 1 && <button type="button" onClick={() => setLines(l => l.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700">×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={() => router.back()} className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </div>
  );
}

export default function NewInventoryInPage() { return <Suspense><NewInventoryInForm /></Suspense>; }
