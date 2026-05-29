'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Cycle { id: string; doc_no: string; heads_available: number; item_name: string; }
interface Item { id: string; sku: string; name: string; }
interface Warehouse { id: string; code: string; name: string; }
interface Line { item_id: string; heads: number; gross_kgs: number; crate_kgs: number; remarks: string; }

function NewTallySheetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ grow_cycle_id: params.get('grow_cycle_id') ?? '', warehouse_id: '', transfer_date: new Date().toISOString().split('T')[0], tally_type: 'harvest', reject_kgs: 0, reject_heads: 0, received_by: '', issued_by: '', checked_by: '', delivery_method: '', plate_number: '', driver: '', helper: '', start_time: '', end_time: '', remarks: '' });
  const [lines, setLines] = useState<Line[]>([{ item_id: '', heads: 0, gross_kgs: 0, crate_kgs: 0, remarks: '' }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: Cycle[] }>(`/poultry/grow-cycles?company_id=${cid}&status=active&limit=100`).then(r => setCycles(r.data)).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=500`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Warehouse[]>(`/inventory/warehouses?company_id=${cid}`).then(r => setWarehouses(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  function updateLine(i: number, f: keyof Line, v: string | number) {
    setLines(prev => { const n = [...prev]; n[i] = { ...n[i], [f]: v }; return n; });
  }

  const netKgsTotal = lines.reduce((s, l) => s + Math.max(0, l.gross_kgs - l.crate_kgs), 0);
  const netHeadsTotal = lines.reduce((s, l) => s + l.heads, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const linesWithNet = lines.map(l => ({ ...l, net_kgs: Math.max(0, l.gross_kgs - l.crate_kgs) }));
      const rec = await api.post<{ id: string }>('/poultry/tally-sheets', { company_id: cid, ...form, lines: linesWithNet });
      router.push(`/dashboard/poultry/tally-sheets/${rec.id}`);
    } catch (e: unknown) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Inventory Tally Sheet</h1>
      <p className="mb-5 text-sm text-slate-500">Record harvest or transfer tally.</p>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Tally Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Type</label>
              <select value={form.tally_type} onChange={e => setForm(f => ({ ...f, tally_type: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="harvest">Harvest</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Grow Cycle</label>
              <select value={form.grow_cycle_id} onChange={e => setForm(f => ({ ...f, grow_cycle_id: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">None / Not linked</option>
                {cycles.map(c => <option key={c.id} value={c.id}>{c.doc_no} — {c.item_name} ({Number(c.heads_available).toLocaleString()} heads)</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Transfer Date *</label>
              <input required type="date" value={form.transfer_date} onChange={e => setForm(f => ({ ...f, transfer_date: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Warehouse</label>
              <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select warehouse…</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Plate Number</label>
              <input type="text" value={form.plate_number} onChange={e => setForm(f => ({ ...f, plate_number: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Driver</label>
              <input type="text" value={form.driver} onChange={e => setForm(f => ({ ...f, driver: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Start Time</label>
              <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">End Time</label>
              <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Received By</label>
              <input type="text" value={form.received_by} onChange={e => setForm(f => ({ ...f, received_by: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Issued By</label>
              <input type="text" value={form.issued_by} onChange={e => setForm(f => ({ ...f, issued_by: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Checked By</label>
              <input type="text" value={form.checked_by} onChange={e => setForm(f => ({ ...f, checked_by: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Remarks</label>
              <input type="text" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Line Items</div>
            <button type="button" onClick={() => setLines(l => [...l, { item_id: '', heads: 0, gross_kgs: 0, crate_kgs: 0, remarks: '' }])} className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left w-48">Item</th>
                <th className="px-2 py-1.5 text-right w-20">Heads</th>
                <th className="px-2 py-1.5 text-right w-24">Gross KGS</th>
                <th className="px-2 py-1.5 text-right w-24">Crate KGS</th>
                <th className="px-2 py-1.5 text-right w-24">Net KGS</th>
                <th className="px-2 py-1.5 text-left">Remarks</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-2 py-1"><select value={l.item_id} onChange={e => updateLine(i, 'item_id', e.target.value)} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"><option value="">Select item…</option>{items.map(it => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}</select></td>
                  <td className="px-2 py-1"><input type="number" min={0} value={l.heads} onChange={e => updateLine(i, 'heads', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="number" min={0} step="any" value={l.gross_kgs} onChange={e => updateLine(i, 'gross_kgs', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1"><input type="number" min={0} step="any" value={l.crate_kgs} onChange={e => updateLine(i, 'crate_kgs', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-2 py-1 text-right font-mono">{Math.max(0, l.gross_kgs - l.crate_kgs).toFixed(2)}</td>
                  <td className="px-2 py-1"><input type="text" value={l.remarks} onChange={e => updateLine(i, 'remarks', e.target.value)} className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></td>
                  <td className="px-1 text-center">{lines.length > 1 && <button type="button" onClick={() => setLines(l => l.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700">×</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <td className="px-2 py-2 text-right text-xs text-slate-500 font-medium" colSpan={2}>Totals →</td>
                <td colSpan={2} />
                <td className="px-2 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">{netKgsTotal.toFixed(2)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
          <div className="mt-3 flex gap-6 text-xs text-slate-500">
            <span>Total Heads: <strong className="text-slate-800 dark:text-slate-200">{netHeadsTotal.toLocaleString()}</strong></span>
            <span>Net KGS: <strong className="text-slate-800 dark:text-slate-200">{netKgsTotal.toFixed(2)}</strong></span>
          </div>
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={() => router.back()} className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300">Cancel</button>
        </div>
      </form>
    </div>
  );
}
export default function NewTallySheetPage() { return <Suspense><NewTallySheetForm /></Suspense>; }
