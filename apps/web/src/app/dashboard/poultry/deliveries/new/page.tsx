'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, type TaggingValues } from '@/components/TaggingPanel';

interface Customer { id: string; code: string; name: string; address: string | null; }
interface Item { id: string; sku: string; name: string; selling_price: number; }
interface Warehouse { id: string; code: string; name: string; }
interface Line { item_id: string; heads: number; kgs: number; unit_price: number; discount_pct: number; remarks: string; }

function NewDeliveryForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taggingData = useTaggingData();
  const [tagging, setTagging] = useState<TaggingValues>({ branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '' });
  const [form, setForm] = useState({
    customer_id: '', warehouse_id: '', transaction_date: new Date().toISOString().split('T')[0],
    commitment_date: '', reference_no: '', delivery_method: '', delivery_address: '',
    plate_number: '', driver: '', remarks: '',
    sales_tally_id: params.get('sales_tally_id') ?? '',
    conversion_id: params.get('conversion_id') ?? '',
  });
  const [lines, setLines] = useState<Line[]>([{ item_id: '', heads: 0, kgs: 0, unit_price: 0, discount_pct: 0, remarks: '' }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: Customer[] }>(`/ar/customers?company_id=${cid}&limit=200`).then(r => setCustomers(r.data)).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=500`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Warehouse[]>(`/inventory/warehouses?company_id=${cid}`).then(r => setWarehouses(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  function updateLine(i: number, f: keyof Line, v: string | number) {
    setLines(prev => {
      const n = [...prev]; const l = { ...n[i] };
      if (f === 'item_id') { const it = items.find(x => x.id === v); l.item_id = v as string; if (it) l.unit_price = it.selling_price; }
      else (l as Record<string, unknown>)[f] = v;
      n[i] = l; return n;
    });
  }

  const grandTotal = lines.reduce((s, l) => s + l.kgs * l.unit_price * (1 - l.discount_pct / 100), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.customer_id) { setError('Select a customer'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const rec = await api.post<{ id: string }>('/poultry/deliveries', {
        company_id: cid, ...form, ...tagging,
        sales_tally_id: form.sales_tally_id || undefined,
        conversion_id: form.conversion_id || undefined,
        commitment_date: form.commitment_date || undefined,
        lines,
      });
      router.push(`/dashboard/poultry/deliveries/${rec.id}`);
    } catch (e: unknown) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Delivery</h1>
      <p className="mb-5 text-sm text-slate-500">Create customer delivery record.</p>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Delivery Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Customer *</label>
              <select required value={form.customer_id} onChange={e => {
                const c = customers.find(x => x.id === e.target.value);
                setForm(f => ({ ...f, customer_id: e.target.value, delivery_address: c?.address ?? f.delivery_address }));
              }} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Date *</label>
              <input required type="date" value={form.transaction_date} onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Commitment Date</label>
              <input type="date" value={form.commitment_date} onChange={e => setForm(f => ({ ...f, commitment_date: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Warehouse</label>
              <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select warehouse…</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Reference No.</label>
              <input type="text" value={form.reference_no} onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Delivery Method</label>
              <input type="text" value={form.delivery_method} onChange={e => setForm(f => ({ ...f, delivery_method: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Plate Number</label>
              <input type="text" value={form.plate_number} onChange={e => setForm(f => ({ ...f, plate_number: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Driver</label>
              <input type="text" value={form.driver} onChange={e => setForm(f => ({ ...f, driver: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Delivery Address</label>
              <input type="text" value={form.delivery_address} onChange={e => setForm(f => ({ ...f, delivery_address: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <TaggingFields value={tagging} data={taggingData} onChange={(f, v) => setTagging(t => ({ ...t, [f]: v }))} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Line Items</div>
            <button type="button" onClick={() => setLines(l => [...l, { item_id: '', heads: 0, kgs: 0, unit_price: 0, discount_pct: 0, remarks: '' }])} className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left w-44">Item</th>
                <th className="px-2 py-1.5 text-right w-20">Heads</th>
                <th className="px-2 py-1.5 text-right w-24">KGS</th>
                <th className="px-2 py-1.5 text-right w-24">Unit Price</th>
                <th className="px-2 py-1.5 text-right w-16">Disc %</th>
                <th className="px-2 py-1.5 text-right w-28">Amount</th>
                <th className="px-2 py-1.5 text-left">Remarks</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-2 py-1"><select value={l.item_id} onChange={e => updateLine(i, 'item_id', e.target.value)} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"><option value="">Select…</option>{items.map(it => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}</select></td>
                  <td className="px-2 py-1"><input type="number" min={0} value={l.heads} onChange={e => updateLine(i, 'heads', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="number" min={0} step="any" value={l.kgs} onChange={e => updateLine(i, 'kgs', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="number" min={0} step="any" value={l.unit_price} onChange={e => updateLine(i, 'unit_price', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="number" min={0} max={100} value={l.discount_pct} onChange={e => updateLine(i, 'discount_pct', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1 text-right font-mono">₱{(l.kgs * l.unit_price * (1 - l.discount_pct / 100)).toFixed(2)}</td>
                  <td className="px-2 py-1"><input type="text" value={l.remarks} onChange={e => updateLine(i, 'remarks', e.target.value)} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-1 text-center">{lines.length > 1 && <button type="button" onClick={() => setLines(l => l.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700">×</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <td colSpan={5} className="px-2 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Grand Total</td>
                <td className="px-2 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">₱{grandTotal.toFixed(2)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={() => router.back()} className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300">Cancel</button>
        </div>
      </form>
    </div>
  );
}
export default function NewDeliveryPage() { return <Suspense><NewDeliveryForm /></Suspense>; }
