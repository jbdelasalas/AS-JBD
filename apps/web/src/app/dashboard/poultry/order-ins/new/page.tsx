'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Supplier { id: string; code: string; name: string; }
interface Item { id: string; sku: string; name: string; standard_cost: number; }
interface Line { item_id: string; quantity: number; uom: string; unit_price: number; remarks: string; }

export default function NewOrderInPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ supplier_id: '', transaction_date: new Date().toISOString().split('T')[0], date_needed: '', reference_no: '', delivery_method: '', payment_terms: '', remarks: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([{ item_id: '', quantity: 1, uom: 'heads', unit_price: 0, remarks: '' }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${cid}&limit=200`).then(r => setSuppliers(r.data)).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=500`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  function updateLine(i: number, f: keyof Line, v: string | number) {
    setLines(prev => { const n = [...prev]; const l = { ...n[i] };
      if (f === 'item_id') { const it = items.find(x => x.id === v); l.item_id = v as string; if (it) l.unit_price = it.standard_cost; }
      else (l as Record<string, unknown>)[f] = v;
      n[i] = l; return n; });
  }

  const grandTotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.supplier_id) { setError('Select a supplier'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const oi = await api.post<{ id: string }>('/poultry/order-ins', { company_id: cid, ...form, lines });
      router.push(`/dashboard/poultry/order-ins/${oi.id}`);
    } catch (e: unknown) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Order In</h1>
      <p className="mb-5 text-sm text-slate-500">Procure day-old chicks from supplier.</p>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Order Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Supplier *</label>
              <select required value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select supplier…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Order Date *</label>
              <input required type="date" value={form.transaction_date} onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Date Needed</label>
              <input type="date" value={form.date_needed} onChange={e => setForm(f => ({ ...f, date_needed: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Reference #</label>
              <input type="text" value={form.reference_no} onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Delivery Method</label>
              <input type="text" value={form.delivery_method} onChange={e => setForm(f => ({ ...f, delivery_method: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Payment Terms</label>
              <input type="text" value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Remarks</label>
              <textarea rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Line Items</div>
            <button type="button" onClick={() => setLines(l => [...l, { item_id: '', quantity: 1, uom: 'heads', unit_price: 0, remarks: '' }])} className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left w-56">Item</th>
                <th className="px-2 py-1.5 text-right w-24">Quantity</th>
                <th className="px-2 py-1.5 text-left w-20">UOM</th>
                <th className="px-2 py-1.5 text-right w-28">Unit Price</th>
                <th className="px-2 py-1.5 text-right w-28">Amount</th>
                <th className="px-2 py-1.5 text-left">Remarks</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-2 py-1">
                    <select value={l.item_id} onChange={e => updateLine(i, 'item_id', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="">Select item…</option>
                      {items.map(it => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1"><input type="number" min={0.0001} step="any" value={l.quantity} onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="text" value={l.uom} onChange={e => updateLine(i, 'uom', e.target.value)} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="number" min={0} step="any" value={l.unit_price} onChange={e => updateLine(i, 'unit_price', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1 text-right font-mono">{(l.quantity * l.unit_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td className="px-2 py-1"><input type="text" value={l.remarks} onChange={e => updateLine(i, 'remarks', e.target.value)} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-1 text-center">{lines.length > 1 && <button type="button" onClick={() => setLines(l => l.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700">×</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <td colSpan={4} className="px-2 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Total</td>
                <td className="px-2 py-2 text-right font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">₱{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save as Draft'}</button>
          <button type="button" onClick={() => router.back()} className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">Cancel</button>
        </div>
      </form>
    </div>
  );
}
