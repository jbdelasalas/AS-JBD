'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, GrowSelect, type TaggingValues } from '@/components/TaggingPanel';

interface Customer { id: string; code: string; name: string; }
interface Item { id: string; sku: string; name: string; selling_price: number; uom: string; }
interface InvoiceRow { id: string; invoice_no: string; total: number; balance: number; }

const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

interface Line {
  item_id: string;
  description: string;
  quantity: number;
  uom: string;
  unit_price: number;
  discount_pct: number;
  vat_rate: number;
  branch_id: string;
  building_id: string;
  cost_center_id: string;
  grow_reference_id: string;
}

function lineTotal(l: Line) {
  const sub = l.quantity * l.unit_price * (1 - l.discount_pct / 100);
  return sub + sub * (l.vat_rate / 100);
}

function NewCreditMemoForm() {
  const router = useRouter();
  const params = useSearchParams();
  const preCustomerId = params.get('customer_id') ?? '';
  const preInvoiceId = params.get('invoice_id') ?? '';

  const tagData = useTaggingData();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    customer_id: preCustomerId,
    original_invoice_id: preInvoiceId,
    cm_date: new Date().toISOString().split('T')[0],
    reason: '',
    notes: '',
  });

  const [tags, setTags] = useState<TaggingValues>({
    branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '',
  });

  const [lines, setLines] = useState<Line[]>([
    { item_id: '', description: '', quantity: 1, uom: '', unit_price: 0, discount_pct: 0, vat_rate: 12,
      branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '' },
  ]);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<{ data: Customer[] }>(`/ar/customers?company_id=${companyId}&is_active=true&limit=200`),
      api.get<Item[]>(`/inventory/items?company_id=${companyId}&limit=200`),
    ]).then(([c, i]) => { setCustomers(c.data); setItems(i); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.customer_id) { setInvoices([]); return; }
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    api.get<{ data: InvoiceRow[] }>(`/ar/invoices?company_id=${cid}&customer_id=${form.customer_id}&status=open&limit=200`)
      .then(r => setInvoices(r.data)).catch(() => {});
  }, [form.customer_id]);

  function handleTagChange(field: keyof TaggingValues, val: string) {
    setTags(t => ({ ...t, [field]: val }));
    setLines(prev => prev.map(l => ({ ...l, [field]: val })));
  }

  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines(prev => {
      const next = [...prev];
      const line = { ...next[idx] };
      if (field === 'item_id' && typeof val === 'string') {
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

  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.customer_id) { setError('Select a customer'); return; }
    setSaving(true);
    try {
      const companyId = localStorage.getItem('company_id')!;
      const cm = await api.post<{ id: string }>('/ar/credit-memos', {
        company_id: companyId,
        customer_id: form.customer_id,
        original_invoice_id: form.original_invoice_id || undefined,
        cm_date: form.cm_date,
        reason: form.reason || undefined,
        notes: form.notes || undefined,
        branch_id: tags.branch_id || undefined,
        lines: lines.map(l => ({
          item_id: l.item_id || undefined,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          vat_rate: l.vat_rate,
        })),
      });
      router.push(`/dashboard/ar/credit-memos/${cm.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New AR Credit Memo</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Issue a credit adjustment — requires approval before applying to invoices.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Credit Memo Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Customer *</label>
              <select required value={form.customer_id}
                onChange={e => setForm(f => ({ ...f, customer_id: e.target.value, original_invoice_id: '' }))}
                className={inp}>
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">CM Date *</label>
              <input required type="date" value={form.cm_date}
                onChange={e => setForm(f => ({ ...f, cm_date: e.target.value }))} className={inp} />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Original Invoice (optional)</label>
              <select value={form.original_invoice_id}
                onChange={e => setForm(f => ({ ...f, original_invoice_id: e.target.value }))}
                className={inp}>
                <option value="">— none —</option>
                {invoices.map(i => <option key={i.id} value={i.id}>{i.invoice_no}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Reason</label>
              <input type="text" value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Return, price correction…" className={inp} />
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
              <textarea rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inp} />
            </div>
            <TaggingFields value={tags} data={tagData} onChange={handleTagChange} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Credit Lines</div>
            <button type="button"
              onClick={() => setLines(l => [...l, { item_id: '', description: '', quantity: 1, uom: '', unit_price: 0, discount_pct: 0, vat_rate: 12, branch_id: tags.branch_id, building_id: tags.building_id, cost_center_id: tags.cost_center_id, grow_reference_id: tags.grow_reference_id }])}
              className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium w-40">Item</th>
                <th className="px-2 py-1.5 text-left font-medium">Description *</th>
                <th className="px-2 py-1.5 text-right font-medium w-16">Qty</th>
                <th className="px-2 py-1.5 text-left font-medium w-14">UOM</th>
                <th className="px-2 py-1.5 text-right font-medium w-24">Unit Price</th>
                <th className="px-2 py-1.5 text-right font-medium w-14">Disc %</th>
                <th className="px-2 py-1.5 text-right font-medium w-14">VAT %</th>
                <th className="px-2 py-1.5 text-right font-medium w-24">Total</th>
                <th className="px-2 py-1.5 text-left font-medium w-24">Location</th>
                <th className="px-2 py-1.5 text-left font-medium w-24">Building</th>
                <th className="px-2 py-1.5 text-left font-medium w-24">Cost Ctr</th>
                <th className="px-2 py-1.5 text-left font-medium w-28">Grow</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-2 py-1">
                    <select value={l.item_id} onChange={e => updateLine(idx, 'item_id', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="">— none —</option>
                      {items.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input required type="text" value={l.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0.0001} step="any" value={l.quantity} onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1 text-slate-500 dark:text-slate-400">{l.uom || '—'}</td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} step="any" value={l.unit_price} onChange={e => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} max={100} step="any" value={l.discount_pct} onChange={e => updateLine(idx, 'discount_pct', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} step="any" value={l.vat_rate} onChange={e => updateLine(idx, 'vat_rate', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    {lineTotal(l).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-2 py-1">
                    <select value={l.branch_id} onChange={e => updateLine(idx, 'branch_id', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="">—</option>
                      {tagData.branches.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <select value={l.building_id} onChange={e => updateLine(idx, 'building_id', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="">—</option>
                      {tagData.buildings.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <select value={l.cost_center_id} onChange={e => updateLine(idx, 'cost_center_id', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="">—</option>
                      {tagData.costCenters.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <GrowSelect value={l.grow_reference_id} data={tagData} onChange={v => updateLine(idx, 'grow_reference_id', v)} />
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
              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <td colSpan={11} className="px-2 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Grand Total (incl. VAT)</td>
                <td className="px-2 py-2 text-right font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                  ₱{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
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

export default function NewCreditMemoPage() {
  return <Suspense><NewCreditMemoForm /></Suspense>;
}
