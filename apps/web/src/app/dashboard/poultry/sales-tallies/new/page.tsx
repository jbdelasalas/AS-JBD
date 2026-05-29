'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, type TaggingValues } from '@/components/TaggingPanel';

interface Customer { id: string; code: string; name: string; }
interface Item { id: string; sku: string; name: string; selling_price: number; }
interface Line { item_id: string; heads: number; gross_kgs: number; crate_kgs: number; unit_price: number; remarks: string; }

export default function NewSalesTallyPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taggingData = useTaggingData();
  const [tagging, setTagging] = useState<TaggingValues>({ branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '' });
  const [form, setForm] = useState({ customer_id: '', transfer_date: new Date().toISOString().split('T')[0], ref_no: '', delivery_ref_no: '', received_by: '', issued_by: '', checked_by: '', delivery_method: '', plate_number: '', driver: '', start_time: '', end_time: '', remarks: '' });
  const [lines, setLines] = useState<Line[]>([{ item_id: '', heads: 0, gross_kgs: 0, crate_kgs: 0, unit_price: 0, remarks: '' }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: Customer[] }>(`/ar/customers?company_id=${cid}&limit=200`).then(r => setCustomers(r.data)).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=500`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  function updateLine(i: number, f: keyof Line, v: string | number) {
    setLines(prev => {
      const n = [...prev]; const l = { ...n[i] };
      if (f === 'item_id') { const it = items.find(x => x.id === v); l.item_id = v as string; if (it) l.unit_price = it.selling_price; }
      else (l as Record<string, unknown>)[f] = v;
      n[i] = l; return n;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const linesWithNet = lines.map(l => ({ ...l, net_kgs: Math.max(0, l.gross_kgs - l.crate_kgs), amount: Math.max(0, l.gross_kgs - l.crate_kgs) * l.unit_price }));
      const rec = await api.post<{ id: string }>('/poultry/sales-tallies', { company_id: cid, ...form, ...tagging, customer_id: form.customer_id || undefined, lines: linesWithNet });
      router.push(`/dashboard/poultry/sales-tallies/${rec.id}`);
    } catch (e: unknown) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Sales Tally Sheet</h1>
      <p className="mb-5 text-sm text-slate-500">Record live chicken sales dispatch.</p>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Tally Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Customer</label>
              <select value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Walk-in / No customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Transfer Date *</label>
              <input required type="date" value={form.transfer_date} onChange={e => setForm(f => ({ ...f, transfer_date: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            {[['ref_no', 'Ref No.'], ['delivery_ref_no', 'Delivery Ref No.'], ['delivery_method', 'Delivery Method'], ['plate_number', 'Plate Number'], ['driver', 'Driver']].map(([k, lbl]) => (
              <div key={k}>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{lbl}</label>
                <input type="text" value={(form as Record<string, string>)[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </div>
            ))}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Start Time</label>
              <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">End Time</label>
              <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            {[['received_by', 'Received By'], ['issued_by', 'Issued By'], ['checked_by', 'Checked By']].map(([k, lbl]) => (
              <div key={k}>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{lbl}</label>
                <input type="text" value={(form as Record<string, string>)[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </div>
            ))}
            <TaggingFields value={tagging} data={taggingData} onChange={(f, v) => setTagging(t => ({ ...t, [f]: v }))} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Line Items</div>
            <button type="button" onClick={() => setLines(l => [...l, { item_id: '', heads: 0, gross_kgs: 0, crate_kgs: 0, unit_price: 0, remarks: '' }])} className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left w-44">Item</th>
                <th className="px-2 py-1.5 text-right w-20">Heads</th>
                <th className="px-2 py-1.5 text-right w-24">Gross KGS</th>
                <th className="px-2 py-1.5 text-right w-24">Crate KGS</th>
                <th className="px-2 py-1.5 text-right w-20">Net KGS</th>
                <th className="px-2 py-1.5 text-right w-24">Unit Price</th>
                <th className="px-2 py-1.5 text-right w-28">Amount</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const net = Math.max(0, l.gross_kgs - l.crate_kgs);
                return (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-1"><select value={l.item_id} onChange={e => updateLine(i, 'item_id', e.target.value)} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"><option value="">Select…</option>{items.map(it => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}</select></td>
                    <td className="px-2 py-1"><input type="number" min={0} value={l.heads} onChange={e => updateLine(i, 'heads', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                    <td className="px-2 py-1"><input type="number" min={0} step="any" value={l.gross_kgs} onChange={e => updateLine(i, 'gross_kgs', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                    <td className="px-2 py-1"><input type="number" min={0} step="any" value={l.crate_kgs} onChange={e => updateLine(i, 'crate_kgs', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                    <td className="px-2 py-1 text-right font-mono">{net.toFixed(2)}</td>
                    <td className="px-2 py-1"><input type="number" min={0} step="any" value={l.unit_price} onChange={e => updateLine(i, 'unit_price', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                    <td className="px-2 py-1 text-right font-mono">₱{(net * l.unit_price).toFixed(2)}</td>
                    <td className="px-1 text-center">{lines.length > 1 && <button type="button" onClick={() => setLines(l => l.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700">×</button>}</td>
                  </tr>
                );
              })}
            </tbody>
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
