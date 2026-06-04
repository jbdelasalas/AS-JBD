'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, type TaggingValues } from '@/components/TaggingPanel';
import { SearchableSelect } from '@/components/SearchableSelect';
import { NumericInput } from '@/components/NumericInput';

interface Supplier { id: string; code: string; name: string; address: string | null; payment_terms_days: number; }
interface Item     { id: string; sku: string; name: string; selling_price: number; uom: string; }
interface Account  { id: string; code: string; name: string; }

interface Line {
  line_type: 'item' | 'gl';
  item_id: string;
  gl_account_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  uom: string;
  branch_id: string;
  building_id: string;
  cost_center_id: string;
  grow_reference_id: string;
}

const EMPTY_LINE: Line = {
  line_type: 'item', item_id: '', gl_account_id: '', description: '',
  quantity: 1, unit_price: 0, vat_rate: 12, uom: '',
  branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '',
};

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const tagData = useTaggingData();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems]         = useState<Item[]>([]);
  const [accounts, setAccounts]   = useState<Account[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [form, setForm] = useState({
    supplier_id: '', po_date: new Date().toISOString().split('T')[0],
    expected_date: '', remarks: '',
  });
  const [tags, setTags] = useState<TaggingValues>({
    branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '',
  });
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${cid}&limit=500&minimal=true`).then(r => setSuppliers(r.data)).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=500&minimal=true`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<{ data: Account[] }>(`/gl/accounts?company_id=${cid}&limit=500`).then(r => setAccounts(r.data ?? [])).catch(() => {});
  }, []);

  // When a header tag changes, propagate to all lines
  function handleTagChange(field: keyof TaggingValues, val: string) {
    setTags(t => ({ ...t, [field]: val }));
    setLines(prev => prev.map(l => ({ ...l, [field]: val })));
  }

  function addLine() {
    setLines(l => [...l, { ...EMPTY_LINE, ...tags }]);
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
        if (item) { line.description = item.name; line.unit_price = item.selling_price; line.uom = item.uom; }
      } else {
        (line as Record<string, unknown>)[field] = val;
      }
      next[idx] = line;
      return next;
    });
  }

  function lineTotal(l: Line) { const sub = l.quantity * l.unit_price; return sub + sub * (l.vat_rate / 100); }
  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.supplier_id) { setError('Select a supplier'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const po = await api.post<{ id: string }>('/purchasing/purchase-orders', {
        company_id: cid,
        ...form,
        ...tags,
        expected_date: form.expected_date || undefined,
        remarks: form.remarks || undefined,
        lines: lines.map(l => ({
          ...l,
          item_id:           l.line_type === 'item' ? l.item_id || undefined : undefined,
          gl_account_id:     l.line_type === 'gl'   ? l.gl_account_id || undefined : undefined,
          branch_id:         l.branch_id || undefined,
          building_id:       l.building_id || undefined,
          cost_center_id:    l.cost_center_id || undefined,
          grow_reference_id: l.grow_reference_id || undefined,
        })),
      });
      router.push(`/dashboard/purchasing/purchase-orders/${po.id}`);
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed'); } finally { setSaving(false); }
  }

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';
  const sel = 'w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Purchase Order</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Create a draft PO — submit for approval when ready.</p>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* PO Header */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">PO Details</div>
          <div className="grid grid-cols-4 gap-4">
            {/* Row 1: Supplier | PO Date | Expected Delivery */}
            <div className="col-span-2">
              <label className={lbl}>Supplier *</label>
              <SearchableSelect
                required
                value={form.supplier_id}
                onChange={v => setForm(f => ({ ...f, supplier_id: v }))}
                placeholder="Select supplier…"
                options={suppliers.map(s => ({ value: s.id, label: `${s.code} — ${s.name}` }))}
              />
            </div>
            <div>
              <label className={lbl}>PO Date *</label>
              <input required type="date" value={form.po_date} onChange={e => setForm(f => ({ ...f, po_date: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Expected Delivery</label>
              <input type="date" value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} className={inp} />
            </div>

            {/* Row 2: Payment Terms (read-only) | Supplier Address (read-only, col-span-3) */}
            {(() => { const s = suppliers.find(x => x.id === form.supplier_id); return (<>
              <div>
                <div className={lbl}>Payment Terms</div>
                <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{s ? `${s.payment_terms_days} days` : '—'}</div>
              </div>
              <div className="col-span-3">
                <div className={lbl}>Supplier Address</div>
                <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">{s?.address ?? '—'}</div>
              </div>
            </>); })()}

            {/* Remarks full-width */}
            <div className="col-span-4">
              <label className={lbl}>Remarks</label>
              <input type="text" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                placeholder="Optional notes" className={inp} />
            </div>

            {/* Header tagging — auto-fills all lines */}
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
                  <th className="px-2 py-1.5 text-left font-medium">Description *</th>
                  <th className="px-2 py-1.5 text-right font-medium w-28">Qty</th>
                  <th className="px-2 py-1.5 text-left font-medium w-14">UOM</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24">Unit Price</th>
                  <th className="px-2 py-1.5 text-right font-medium w-12">VAT%</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24">Total</th>
                  <th className="px-2 py-1.5 text-left font-medium w-28">Location</th>
                  <th className="px-2 py-1.5 text-left font-medium w-28">Building</th>
                  <th className="px-2 py-1.5 text-left font-medium w-28">Cost Center</th>
                  <th className="px-2 py-1.5 text-left font-medium w-24">Grow</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-1">
                      <select value={l.line_type} onChange={e => updateLine(idx, 'line_type', e.target.value)} className={sel}>
                        <option value="item">Item</option>
                        <option value="gl">GL Account</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      {l.line_type === 'item' ? (
                        <SearchableSelect
                          value={l.item_id}
                          onChange={v => updateLine(idx, 'item_id', v)}
                          placeholder="Select item…"
                          options={items.map(i => ({ value: i.id, label: `${i.sku} — ${i.name}` }))}
                        />
                      ) : (
                        <SearchableSelect
                          value={l.gl_account_id}
                          onChange={v => updateLine(idx, 'gl_account_id', v)}
                          placeholder="Select account…"
                          options={accounts.map(a => ({ value: a.id, label: `${a.code} ${a.name}` }))}
                        />
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <input required type="text" value={l.description}
                        onChange={e => updateLine(idx, 'description', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <NumericInput value={l.quantity} onChange={v => updateLine(idx, 'quantity', v)}
                        min={0} decimals={4}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400">{l.uom || '—'}</td>
                    <td className="px-2 py-1">
                      <NumericInput value={l.unit_price} onChange={v => updateLine(idx, 'unit_price', v)}
                        min={0} decimals={4}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <NumericInput value={l.vat_rate} onChange={v => updateLine(idx, 'vat_rate', v)}
                        min={0} decimals={2}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1 text-right font-mono dark:text-slate-300">
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
                        <button type="button" onClick={() => setLines(l => l.filter((_, i) => i !== idx))}
                          className="text-red-500 hover:text-red-700">×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <td colSpan={6} className="px-2 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Grand Total (incl. VAT)</td>
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
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
