'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Item { id: string; sku: string; name: string; }
interface Warehouse { id: string; code: string; name: string; }
interface Output { output_item_id: string; heads: number; kgs: number; unit_cost: number; remarks: string; }

function NewConversionForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ source_item_id: '', source_heads: 0, source_kgs: 0, warehouse_id: '', transaction_date: new Date().toISOString().split('T')[0], tally_sheet_id: params.get('tally_sheet_id') ?? '', remarks: '' });
  const [outputs, setOutputs] = useState<Output[]>([{ output_item_id: '', heads: 0, kgs: 0, unit_cost: 0, remarks: '' }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=500`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Warehouse[]>(`/inventory/warehouses?company_id=${cid}`).then(r => setWarehouses(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const totalOut = outputs.reduce((s, o) => s + o.kgs, 0);
  const yieldPct = form.source_kgs > 0 ? ((totalOut / form.source_kgs) * 100).toFixed(2) : '—';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.source_item_id) { setError('Select source item'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const rec = await api.post<{ id: string }>('/poultry/conversions', { company_id: cid, ...form, tally_sheet_id: form.tally_sheet_id || undefined, outputs });
      router.push(`/dashboard/poultry/conversions/${rec.id}`);
    } catch (e: unknown) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Conversion</h1>
      <p className="mb-5 text-sm text-slate-500">Convert live/raw chicken into finished products.</p>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium">Conversion Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Date *</label>
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
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Remarks</label>
              <input type="text" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
            <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">Source (Input)</div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <label className="mb-1 block text-xs text-slate-500">Source Item *</label>
                <select required value={form.source_item_id} onChange={e => setForm(f => ({ ...f, source_item_id: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
                  <option value="">Select item…</option>
                  {items.map(it => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Source Heads</label>
                <input type="number" min={0} value={form.source_heads} onChange={e => setForm(f => ({ ...f, source_heads: parseFloat(e.target.value) || 0 }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Source KGS *</label>
                <input required type="number" min={0} step="any" value={form.source_kgs} onChange={e => setForm(f => ({ ...f, source_kgs: parseFloat(e.target.value) || 0 }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Output Products <span className="ml-2 text-xs text-slate-500">Yield: {yieldPct}{form.source_kgs > 0 ? '%' : ''}</span></div>
            <button type="button" onClick={() => setOutputs(o => [...o, { output_item_id: '', heads: 0, kgs: 0, unit_cost: 0, remarks: '' }])} className="text-xs text-brand-600 hover:underline">+ Add output</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left w-48">Output Item</th>
                <th className="px-2 py-1.5 text-right w-20">Heads</th>
                <th className="px-2 py-1.5 text-right w-24">KGS</th>
                <th className="px-2 py-1.5 text-right w-24">Unit Cost</th>
                <th className="px-2 py-1.5 text-right w-28">Total Cost</th>
                <th className="px-2 py-1.5 text-left">Remarks</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {outputs.map((o, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-2 py-1"><select value={o.output_item_id} onChange={e => setOutputs(prev => { const n = [...prev]; n[i] = { ...n[i], output_item_id: e.target.value }; return n; })} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"><option value="">Select item…</option>{items.map(it => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}</select></td>
                  <td className="px-2 py-1"><input type="number" min={0} value={o.heads} onChange={e => setOutputs(prev => { const n = [...prev]; n[i] = { ...n[i], heads: parseFloat(e.target.value) || 0 }; return n; })} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="number" min={0} step="any" value={o.kgs} onChange={e => setOutputs(prev => { const n = [...prev]; n[i] = { ...n[i], kgs: parseFloat(e.target.value) || 0 }; return n; })} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="number" min={0} step="any" value={o.unit_cost} onChange={e => setOutputs(prev => { const n = [...prev]; n[i] = { ...n[i], unit_cost: parseFloat(e.target.value) || 0 }; return n; })} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1 text-right font-mono">₱{(o.kgs * o.unit_cost).toFixed(2)}</td>
                  <td className="px-2 py-1"><input type="text" value={o.remarks} onChange={e => setOutputs(prev => { const n = [...prev]; n[i] = { ...n[i], remarks: e.target.value }; return n; })} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-1 text-center">{outputs.length > 1 && <button type="button" onClick={() => setOutputs(o => o.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700">×</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <td colSpan={2} className="px-2 py-2 text-right text-xs font-medium text-slate-600">Totals</td>
                <td className="px-2 py-2 text-right font-mono font-semibold">{totalOut.toFixed(2)}</td>
                <td />
                <td className="px-2 py-2 text-right font-mono font-semibold">₱{outputs.reduce((s, o) => s + o.kgs * o.unit_cost, 0).toFixed(2)}</td>
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
export default function NewConversionPage() { return <Suspense><NewConversionForm /></Suspense>; }
