'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, type TaggingValues } from '@/components/TaggingPanel';

interface Customer { id: string; code: string; name: string; payment_terms_days: number; credit_limit: number; address: string | null; }
interface Item { id: string; sku: string; name: string; selling_price: number; }
interface Account { id: string; code: string; name: string; }

interface Line {
  line_type: 'item' | 'gl';
  item_id: string;
  gl_account_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  vat_rate: number;
  branch_id: string;
  building_id: string;
  cost_center_id: string;
  grow_reference_id: string;
}

const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';
const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const ro  = 'rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
const sel = 'w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

const EMPTY_LINE: Line = {
  line_type: 'item', item_id: '', gl_account_id: '', description: '',
  quantity: 1, unit_price: 0, discount_pct: 0, vat_rate: 12,
  branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '',
};

export default function NewSalesOrderPage() {
  const router = useRouter();
  const tagData = useTaggingData();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems]         = useState<Item[]>([]);
  const [accounts, setAccounts]   = useState<Account[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [form, setForm] = useState({
    customer_id: '',
    order_date: new Date().toISOString().split('T')[0],
    delivery_date: '',
    payment_terms_days: 30,
    reference: '',
    notes: '',
    with_si: true,
  });

  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [tags, setTags]   = useState<TaggingValues>({ branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '' });

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    api.get<{ data: Customer[] }>(`/ar/customers?company_id=${cid}&is_active=true&limit=200`).then(c => setCustomers(c.data)).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=200`).then(i => setItems(i)).catch(() => {});
    api.get<{ data: Account[] }>(`/gl/accounts?company_id=${cid}&limit=500`).then(r => setAccounts(r.data ?? [])).catch(() => {});
  }, []);

  function handleTagChange(field: keyof TaggingValues, val: string) {
    setTags(t => ({ ...t, [field]: val }));
    if (field === 'grow_reference_id') setLines(prev => prev.map(l => ({ ...l, grow_reference_id: val })));
  }

  function addLine() {
    setLines(l => [...l, { ...EMPTY_LINE, grow_reference_id: tags.grow_reference_id }]);
  }

  function removeLine(idx: number) {
    setLines(l => l.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines(prev => {
      const next = [...prev];
      const line = { ...next[idx] };
      if (field === 'line_type') {
        line.line_type = val as 'item' | 'gl';
        if (val === 'gl') line.item_id = '';
        if (val === 'item') line.gl_account_id = '';
      } else if (field === 'item_id' && typeof val === 'string') {
        const item = items.find(i => i.id === val);
        line.item_id = val;
        if (item) { line.description = item.name; line.unit_price = item.selling_price; }
      } else {
        (line as Record<string, unknown>)[field] = val;
      }
      next[idx] = line;
      return next;
    });
  }

  function lineTotal(l: Line) {
    const sub = l.quantity * l.unit_price * (1 - l.discount_pct / 100);
    return sub + sub * (l.vat_rate / 100);
  }

  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.customer_id) { setError('Select a customer'); return; }
    if (lines.some(l => l.line_type === 'item' && !l.item_id)) { setError('All item lines must have an item selected'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const order = await api.post<{ id: string }>('/sales/orders', {
        company_id: cid,
        ...form,
        branch_id: tags.branch_id || undefined,
        building_id: tags.building_id || undefined,
        cost_center_id: tags.cost_center_id || undefined,
        grow_reference_id: tags.grow_reference_id || undefined,
        delivery_date: form.delivery_date || undefined,
        lines: lines.map(l => ({
          ...l,
          item_id: l.line_type === 'item' ? l.item_id || undefined : undefined,
          branch_id: l.branch_id || undefined,
          building_id: l.building_id || undefined,
          cost_center_id: l.cost_center_id || undefined,
          grow_reference_id: l.grow_reference_id || undefined,
        })),
      });
      router.push(`/dashboard/sales/orders/${order.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create order');
    } finally {
      setSaving(false);
    }
  }

  const selectedCustomer = customers.find(x => x.id === form.customer_id);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Sales Order</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Fill in the order details and line items.</p>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Order Details */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Order Details</div>
          <div className="grid grid-cols-4 gap-4">

            {/* Row 1: Customer | Order Date | Delivery Date */}
            <div className="col-span-2">
              <label className={lbl}>Customer *</label>
              <select required value={form.customer_id}
                onChange={e => {
                  const c = customers.find(x => x.id === e.target.value);
                  setForm(f => ({ ...f, customer_id: e.target.value, payment_terms_days: c?.payment_terms_days ?? 30 }));
                }}
                className={inp}>
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Order Date *</label>
              <input required type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Delivery Date</label>
              <input type="date" value={form.delivery_date} onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} className={inp} />
            </div>

            {/* Row 2: Payment Terms (read-only) | Customer Address (read-only, col-span-3) */}
            <div>
              <label className={lbl}>Payment Terms</label>
              <div className={ro}>{selectedCustomer ? `${form.payment_terms_days} days` : '—'}</div>
            </div>
            <div className="col-span-3">
              <label className={lbl}>Customer Address</label>
              <div className={ro}>{selectedCustomer?.address ?? '—'}</div>
            </div>

            {/* Row 3: Reference | With SI checkbox */}
            <div className="col-span-3">
              <label className={lbl}>Reference</label>
              <input type="text" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                placeholder="PO no., contract ref…" className={inp} />
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.with_si}
                  onChange={e => setForm(f => ({ ...f, with_si: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">With SI</span>
              </label>
            </div>

            {/* Row 4: Notes full-width */}
            <div className="col-span-4">
              <label className={lbl}>Notes</label>
              <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className={inp} />
            </div>

            {/* Row 5: Location | Building | Cost Center | Grow */}
            <TaggingFields value={tags} data={tagData} onChange={handleTagChange} />
          </div>
        </div>

        {/* Line Items */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Line Items</div>
            <button type="button" onClick={addLine} className="text-xs text-brand-600 hover:underline dark:text-brand-400">+ Add line</button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Type</th>
                  <th className="px-2 py-1.5 text-left font-medium w-36">Account / Item</th>
                  <th className="px-2 py-1.5 text-left font-medium">Description</th>
                  <th className="px-2 py-1.5 text-right font-medium w-14">Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium w-22">Unit Price</th>
                  <th className="px-2 py-1.5 text-right font-medium w-12">Disc%</th>
                  <th className="px-2 py-1.5 text-right font-medium w-12">VAT%</th>
                  <th className="px-2 py-1.5 text-right font-medium w-22">Total</th>
                  <th className="px-2 py-1.5 text-left font-medium w-24">Location</th>
                  <th className="px-2 py-1.5 text-left font-medium w-24">Building</th>
                  <th className="px-2 py-1.5 text-left font-medium w-24">Cost Center</th>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Grow</th>
                  <th className="w-5" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-1">
                      <select value={l.line_type} onChange={e => updateLine(idx, 'line_type', e.target.value)} className={sel}>
                        <option value="item">Item</option>
                        <option value="gl">GL Acct</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      {l.line_type === 'item' ? (
                        <select value={l.item_id} onChange={e => updateLine(idx, 'item_id', e.target.value)} className={sel}>
                          <option value="">Select…</option>
                          {items.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                        </select>
                      ) : (
                        <select value={l.gl_account_id} onChange={e => updateLine(idx, 'gl_account_id', e.target.value)} className={sel}>
                          <option value="">Select…</option>
                          {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={l.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" min={0.0001} step="any" value={l.quantity}
                        onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" min={0} step="any" value={l.unit_price}
                        onChange={e => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" min={0} max={100} step="any" value={l.discount_pct}
                        onChange={e => updateLine(idx, 'discount_pct', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" min={0} step="any" value={l.vat_rate}
                        onChange={e => updateLine(idx, 'vat_rate', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs" />
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {lineTotal(l).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.branch_id} onChange={e => updateLine(idx, 'branch_id', e.target.value)} className={sel}>
                        <option value="">—</option>
                        {tagData.branches.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.building_id} onChange={e => updateLine(idx, 'building_id', e.target.value)} className={sel}>
                        <option value="">—</option>
                        {tagData.buildings.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.cost_center_id} onChange={e => updateLine(idx, 'cost_center_id', e.target.value)} className={sel}>
                        <option value="">—</option>
                        {tagData.costCenters.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.grow_reference_id} onChange={e => updateLine(idx, 'grow_reference_id', e.target.value)} className={sel}>
                        <option value="">—</option>
                        {tagData.growRefs.map(g => <option key={g.id} value={g.id}>{g.code}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1 text-center">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-700">×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <td colSpan={7} className="px-2 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Grand Total</td>
                  <td className="px-2 py-2 text-right font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                    ₱{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
