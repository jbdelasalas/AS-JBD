'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, type TaggingValues } from '@/components/TaggingPanel';
import type { SalesOrder } from '@perpet/shared';

interface Customer { id: string; code: string; name: string; payment_terms_days: number; address: string | null; }
interface SORow    { id: string; order_no: string; customer_id: string; }
interface Item     { id: string; sku: string; name: string; selling_price: number; kg_per_bag: number | null; kg_per_pcs: number | null; }

interface Line {
  item_id: string; description: string;
  qty_ordered: number; qty_allocated: number; allocation_unit: string;
  unit_price: number; discount_pct: number; vat_rate: number;
  branch_id: string; building_id: string; cost_center_id: string; grow_reference_id: string;
}

const UNITS = ['Kg', 'Bags', 'Pcs'];

// Convert an allocation quantity in the given unit to kilos, using the item's
// per-bag / per-pcs factors. Kg/Kls pass through unchanged.
function toKg(qty: number, unit: string, item?: Item | null): number {
  const u = unit.toLowerCase();
  if (u === 'kg' || u === 'kls') return qty;
  if ((u === 'bag' || u === 'bags') && item?.kg_per_bag) return qty * item.kg_per_bag;
  if ((u === 'pcs' || u === 'pc' || u === 'piece') && item?.kg_per_pcs) return qty * item.kg_per_pcs;
  return qty; // no factor set — fall back to raw qty
}
const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';
const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const ro  = 'rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
const sel = 'w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

const EMPTY_LINE: Line = {
  item_id: '', description: '', qty_ordered: 0, qty_allocated: 0, allocation_unit: 'Kg',
  unit_price: 0, discount_pct: 0, vat_rate: 12,
  branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '',
};

export default function NewAllocationPage() {
  const router  = useRouter();
  const search  = useSearchParams();
  const fromSo  = search.get('from_so');
  const tagData = useTaggingData();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders]       = useState<SORow[]>([]);
  const [items, setItems]         = useState<Item[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [form, setForm] = useState({
    customer_id: '', so_id: '',
    allocation_date: new Date().toISOString().split('T')[0],
    delivery_date: '', reference: '', notes: '', with_si: true,
  });
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [tags, setTags]   = useState<TaggingValues>({ branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '' });

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: Customer[] }>(`/ar/customers?company_id=${cid}&is_active=true&limit=200`).then(c => setCustomers(c.data)).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=200`).then(i => setItems(i)).catch(() => {});
  }, []);

  // Prefill from a Sales Order when arriving via "Create Allocation"
  useEffect(() => {
    if (!fromSo) return;
    api.get<SalesOrder>(`/sales/orders/${fromSo}`).then(so => {
      setForm(f => ({
        ...f,
        customer_id: so.customer_id,
        so_id: so.id,
        delivery_date: so.delivery_date ?? '',
        reference: so.order_no,
      }));
      setTags({
        branch_id: so.branch_id ?? '',
        building_id: so.building_id ?? '',
        cost_center_id: so.cost_center_id ?? '',
        grow_reference_id: so.grow_reference_id ?? '',
      });
      const soLines = so.lines ?? [];
      if (soLines.length) {
        setLines(soLines.map(l => {
          const remaining = Number(l.quantity) - Number(l.qty_delivered);
          return {
            item_id: l.item_id,
            description: l.description,
            qty_ordered: Number(l.quantity),
            qty_allocated: remaining > 0 ? remaining : 0,
            allocation_unit: l.item_uom && UNITS.includes(l.item_uom) ? l.item_uom : 'Kg',
            unit_price: Number(l.unit_price),
            discount_pct: Number(l.discount_pct ?? 0),
            vat_rate: Number(l.vat_rate ?? 12),
            branch_id: l.branch_id ?? '',
            building_id: l.building_id ?? '',
            cost_center_id: l.cost_center_id ?? '',
            grow_reference_id: l.grow_reference_id ?? '',
          };
        }));
      }
    }).catch(() => setError('Failed to load sales order'));
  }, [fromSo]);

  // Load SOs for selected customer
  useEffect(() => {
    if (!form.customer_id) { setOrders([]); return; }
    const cid = localStorage.getItem('company_id');
    api.get<{ data: SORow[] }>(`/sales/orders?company_id=${cid}&customer_id=${form.customer_id}&status=approved&limit=100`)
      .then(r => setOrders(r.data ?? [])).catch(() => {});
  }, [form.customer_id]);

  function handleTagChange(field: keyof TaggingValues, val: string) {
    setTags(t => ({ ...t, [field]: val }));
    if (field === 'grow_reference_id') setLines(prev => prev.map(l => ({ ...l, grow_reference_id: val })));
  }

  function addLine() { setLines(l => [...l, { ...EMPTY_LINE, grow_reference_id: tags.grow_reference_id }]); }
  function removeLine(idx: number) { setLines(l => l.filter((_, i) => i !== idx)); }
  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines(prev => {
      const next = [...prev];
      const line = { ...next[idx] };
      if (field === 'item_id' && typeof val === 'string') {
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

  const selectedCustomer = customers.find(x => x.id === form.customer_id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.customer_id) { setError('Select a customer'); return; }
    if (lines.some(l => !l.item_id)) { setError('All lines must have an item selected'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const res = await api.post<{ id: string }>('/sales/allocations', {
        company_id: cid, ...form,
        so_id: form.so_id || undefined,
        delivery_date: form.delivery_date || undefined,
        branch_id: tags.branch_id || undefined,
        building_id: tags.building_id || undefined,
        cost_center_id: tags.cost_center_id || undefined,
        grow_reference_id: tags.grow_reference_id || undefined,
        lines: lines.map(l => ({
          ...l,
          branch_id: l.branch_id || undefined,
          building_id: l.building_id || undefined,
          cost_center_id: l.cost_center_id || undefined,
          grow_reference_id: l.grow_reference_id || undefined,
        })),
      });
      router.push(`/dashboard/sales/allocations/${res.id}`);
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Order Allocation</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Allocate quantities against a customer order. Posting creates a Sales Tally Sheet.</p>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Allocation Details</div>
          <div className="grid grid-cols-4 gap-4">

            {/* Row 1: Customer | Allocation Date | Delivery Date */}
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
              <label className={lbl}>Allocation Date *</label>
              <input required type="date" value={form.allocation_date}
                onChange={e => setForm(f => ({ ...f, allocation_date: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Delivery Date</label>
              <input type="date" value={form.delivery_date}
                onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} className={inp} />
            </div>

            {/* Row 2: Payment Terms (read-only) | Customer Address (read-only) */}
            <div>
              <label className={lbl}>Payment Terms</label>
              <div className={ro}>{selectedCustomer ? `${selectedCustomer.payment_terms_days} days` : '—'}</div>
            </div>
            <div className="col-span-3">
              <label className={lbl}>Customer Address</label>
              <div className={ro}>{selectedCustomer?.address ?? '—'}</div>
            </div>

            {/* Row 3: SO Reference | Reference | With SI */}
            <div>
              <label className={lbl}>SO Reference</label>
              <select value={form.so_id} onChange={e => setForm(f => ({ ...f, so_id: e.target.value }))} className={inp}>
                <option value="">— none —</option>
                {orders.map(o => <option key={o.id} value={o.id}>{o.order_no}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={lbl}>Reference</label>
              <input type="text" value={form.reference}
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                placeholder="DR no., contract ref…" className={inp} />
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.with_si}
                  onChange={e => setForm(f => ({ ...f, with_si: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">With SI</span>
              </label>
            </div>

            {/* Row 4: Notes */}
            <div className="col-span-4">
              <label className={lbl}>Notes</label>
              <textarea rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inp} />
            </div>

            {/* Row 5: Tagging */}
            <TaggingFields value={tags} data={tagData} onChange={handleTagChange} />
          </div>
        </div>

        {/* Line Items */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Allocation Lines</div>
            <button type="button" onClick={addLine} className="text-xs text-brand-600 hover:underline dark:text-brand-400">+ Add line</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium w-36">Item</th>
                  <th className="px-2 py-1.5 text-left font-medium">Description</th>
                  <th className="px-2 py-1.5 text-right font-medium w-20">Qty Ordered</th>
                  <th className="px-2 py-1.5 text-right font-medium w-20">Qty Allocated</th>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Unit</th>
                  <th className="px-2 py-1.5 text-right font-medium w-16">≈ Kg</th>
                  <th className="px-2 py-1.5 text-right font-medium w-22">Unit Price</th>
                  <th className="px-2 py-1.5 text-right font-medium w-12">Disc%</th>
                  <th className="px-2 py-1.5 text-right font-medium w-12">VAT%</th>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Location</th>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Building</th>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Cost Ctr</th>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Grow</th>
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
                      <input type="text" value={l.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" min={0} step="any" value={l.qty_ordered}
                        onChange={e => updateLine(idx, 'qty_ordered', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" min={0} step="any" value={l.qty_allocated}
                        onChange={e => updateLine(idx, 'qty_allocated', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs font-semibold" />
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.allocation_unit} onChange={e => updateLine(idx, 'allocation_unit', e.target.value)} className={sel}>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right text-xs text-slate-600 dark:text-slate-400">
                      {toKg(l.qty_allocated, l.allocation_unit, items.find(i => i.id === l.item_id)).toLocaleString('en-PH', { maximumFractionDigits: 2 })}
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
