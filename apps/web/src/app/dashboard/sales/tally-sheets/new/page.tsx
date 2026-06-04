'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { api } from '@/lib/api';

interface Customer { id: string; code: string; name: string; }
interface SORow { id: string; order_no: string; customer_id: string; }
interface Item { id: string; sku: string; name: string; uom: string; }

interface Line {
  item_id: string; description: string;
  qty_allocated: number; allocation_unit: string;
  actual_qty: number; actual_weight_kgs: number;
  unit_price: number;
}

const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';
const sel = 'w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

function NewTallyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const poultryTallyId = params.get('from_tally_id') ?? undefined;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders]       = useState<SORow[]>([]);
  const [items, setItems]         = useState<Item[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [form, setForm] = useState({
    customer_id: '',
    so_id: '',
    tally_date: new Date().toISOString().split('T')[0],
    delivery_date: '',
    reference: '',
    notes: '',
  });

  const [lines, setLines] = useState<Line[]>([
    { item_id: '', description: '', qty_allocated: 0, allocation_unit: 'Pcs', actual_qty: 0, actual_weight_kgs: 0, unit_price: 0 },
  ]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: Customer[] }>(`/ar/customers?company_id=${cid}&is_active=true&limit=200`).then(r => setCustomers(r.data)).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=500`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});

    // Load pre-fill data from sessionStorage (set by poultry tally)
    const raw = sessionStorage.getItem('pending_sales_tally');
    if (raw) {
      try {
        const d = JSON.parse(raw) as {
          poultry_tally_id?: string; tally_date?: string;
          lines?: Array<{ item_id: string; description: string; net_kgs: number; heads: number; }>;
        };
        if (d.tally_date) setForm(f => ({ ...f, tally_date: d.tally_date! }));
        if (d.lines?.length) {
          setLines(d.lines.map(l => ({
            item_id: l.item_id, description: l.description,
            qty_allocated: l.heads > 0 ? l.heads : 0,
            allocation_unit: 'Pcs',
            actual_qty: l.heads > 0 ? l.heads : 0,
            actual_weight_kgs: l.net_kgs,
            unit_price: 0,
          })));
        }
        sessionStorage.removeItem('pending_sales_tally');
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!form.customer_id) { setOrders([]); return; }
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: SORow[] }>(`/sales/orders?company_id=${cid}&customer_id=${form.customer_id}&status=approved&status=partially_delivered&limit=100`)
      .then(r => setOrders(r.data ?? [])).catch(() => {});
  }, [form.customer_id]);

  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines(prev => {
      const next = [...prev];
      const line = { ...next[idx], [field]: val };
      if (field === 'item_id' && typeof val === 'string') {
        const item = items.find(i => i.id === val);
        if (item) { line.description = item.name; line.allocation_unit = item.uom || 'Pcs'; }
      }
      next[idx] = line;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.customer_id) { setError('Select a customer'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const customer = customers.find(c => c.id === form.customer_id);
      const res = await api.post<{ id: string; tally_no: string }>('/sales/tally-sheets', {
        company_id: cid,
        customer_id: form.customer_id,
        customer_name: customer?.name ?? '',
        so_id: form.so_id || undefined,
        poultry_tally_id: poultryTallyId ?? undefined,
        tally_date: form.tally_date,
        delivery_date: form.delivery_date || undefined,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
        lines: lines.filter(l => l.item_id),
      });
      router.push(`/dashboard/sales/tally-sheets/${res.id}`);
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Sales Tally Sheet</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">
        Record actual delivery quantities — link to a Sales Order to enable DR creation.
      </p>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Tally Details</div>
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className={lbl}>Customer *</label>
              <select required value={form.customer_id}
                onChange={e => setForm(f => ({ ...f, customer_id: e.target.value, so_id: '' }))}
                className={inp}>
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Tally Date *</label>
              <input required type="date" value={form.tally_date}
                onChange={e => setForm(f => ({ ...f, tally_date: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Delivery Date</label>
              <input type="date" value={form.delivery_date}
                onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} className={inp} />
            </div>
            <div className="col-span-2">
              <label className={lbl}>Sales Order (for DR fulfillment)</label>
              <select value={form.so_id} onChange={e => setForm(f => ({ ...f, so_id: e.target.value }))} className={inp}>
                <option value="">— none —</option>
                {orders.map(o => <option key={o.id} value={o.id}>{o.order_no}</option>)}
              </select>
              {!form.customer_id && <p className="mt-1 text-xs text-slate-400">Select a customer first</p>}
            </div>
            <div>
              <label className={lbl}>Reference</label>
              <input type="text" value={form.reference}
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Notes</label>
              <input type="text" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inp} />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Tally Lines</div>
            <button type="button"
              onClick={() => setLines(l => [...l, { item_id: '', description: '', qty_allocated: 0, allocation_unit: 'Pcs', actual_qty: 0, actual_weight_kgs: 0, unit_price: 0 }])}
              className="text-xs text-brand-600 hover:underline dark:text-brand-400">
              + Add line
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium w-36">Item</th>
                  <th className="px-2 py-1.5 text-left font-medium">Description</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24">Qty Allocated</th>
                  <th className="px-2 py-1.5 text-left font-medium w-16">Unit</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24 bg-green-50 dark:bg-green-950">Actual Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium w-28 bg-green-50 dark:bg-green-950">Actual Wt (Kgs)</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24">Unit Price</th>
                  <th className="w-5" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-1">
                      <select value={l.item_id} onChange={e => updateLine(idx, 'item_id', e.target.value)} className={sel}>
                        <option value="">Select…</option>
                        {items.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={l.description}
                        onChange={e => updateLine(idx, 'description', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" min={0} step="any" value={l.qty_allocated}
                        onChange={e => updateLine(idx, 'qty_allocated', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={l.allocation_unit}
                        onChange={e => updateLine(idx, 'allocation_unit', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1 bg-green-50/50 dark:bg-green-950/30">
                      <input type="number" min={0} step="any" value={l.actual_qty}
                        onChange={e => updateLine(idx, 'actual_qty', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs font-semibold text-green-700 dark:border-slate-600 dark:bg-slate-800 dark:text-green-400" />
                    </td>
                    <td className="px-2 py-1 bg-green-50/50 dark:bg-green-950/30">
                      <input type="number" min={0} step="any" value={l.actual_weight_kgs}
                        onChange={e => updateLine(idx, 'actual_weight_kgs', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs font-semibold text-green-700 dark:border-slate-600 dark:bg-slate-800 dark:text-green-400" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" min={0} step="any" value={l.unit_price}
                        onChange={e => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs" />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines(l => l.filter((_, i) => i !== idx))}
                          className="text-red-500 hover:text-red-700">×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Tally Sheet'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewTallySheetPage() {
  return <Suspense><NewTallyForm /></Suspense>;
}
