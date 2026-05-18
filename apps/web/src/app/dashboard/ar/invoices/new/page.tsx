'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Customer { id: string; code: string; name: string; payment_terms_days: number; }
interface Item { id: string; sku: string; name: string; selling_price: number; }

interface Line {
  item_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  vat_rate: number;
}

function NewInvoiceForm() {
  const router = useRouter();
  const params = useSearchParams();
  const preCustomerId = params.get('customer_id') ?? '';
  const preSoId = params.get('so_id') ?? '';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    customer_id: preCustomerId,
    invoice_date: new Date().toISOString().split('T')[0],
    payment_terms_days: 30,
    reference: '',
    notes: '',
  });

  const [lines, setLines] = useState<Line[]>([
    { item_id: '', description: '', quantity: 1, unit_price: 0, discount_pct: 0, vat_rate: 12 },
  ]);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<{ data: Customer[] }>(`/ar/customers?company_id=${companyId}&is_active=true&limit=200`),
      api.get<Item[]>(`/inventory/items?company_id=${companyId}&limit=200`),
    ]).then(([c, i]) => { setCustomers(c.data); setItems(i); }).catch(() => {});
  }, []);

  function addLine() {
    setLines((l) => [...l, { item_id: '', description: '', quantity: 1, unit_price: 0, discount_pct: 0, vat_rate: 12 }]);
  }

  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines((prev) => {
      const next = [...prev];
      const line = { ...next[idx] };
      if (field === 'item_id' && typeof val === 'string') {
        const item = items.find((i) => i.id === val);
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
    setSaving(true);
    try {
      const companyId = localStorage.getItem('company_id')!;
      const inv = await api.post<{ id: string }>('/ar/invoices', {
        company_id: companyId,
        ...form,
        so_id: preSoId || undefined,
        lines: lines.map((l) => ({ ...l, item_id: l.item_id || undefined })),
      });
      router.push(`/dashboard/ar/invoices/${inv.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Sales Invoice</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Create a draft invoice — post it to generate the GL entry and AR.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Invoice Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Customer *</label>
              <select required value={form.customer_id}
                onChange={(e) => {
                  const c = customers.find((x) => x.id === e.target.value);
                  setForm((f) => ({ ...f, customer_id: e.target.value, payment_terms_days: c?.payment_terms_days ?? 30 }));
                }}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Invoice Date *</label>
              <input required type="date" value={form.invoice_date}
                onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Payment Terms (days)</label>
              <input type="number" min={0} value={form.payment_terms_days}
                onChange={(e) => setForm((f) => ({ ...f, payment_terms_days: parseInt(e.target.value) }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Reference / SO no.</label>
              <input type="text" value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
              <textarea rows={2} value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Line Items</div>
            <button type="button" onClick={addLine} className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium w-48">Item</th>
                <th className="px-2 py-1.5 text-left font-medium">Description *</th>
                <th className="px-2 py-1.5 text-right font-medium w-20">Qty</th>
                <th className="px-2 py-1.5 text-right font-medium w-28">Unit Price</th>
                <th className="px-2 py-1.5 text-right font-medium w-16">Disc %</th>
                <th className="px-2 py-1.5 text-right font-medium w-16">VAT %</th>
                <th className="px-2 py-1.5 text-right font-medium w-28">Total</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-2 py-1">
                    <select value={l.item_id} onChange={(e) => updateLine(idx, 'item_id', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1">
                      <option value="">— none —</option>
                      {items.map((i) => <option key={i.id} value={i.id}>{i.sku}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input required type="text" value={l.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0.0001} step="any" value={l.quantity}
                      onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} step="any" value={l.unit_price}
                      onChange={(e) => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} max={100} step="any" value={l.discount_pct}
                      onChange={(e) => updateLine(idx, 'discount_pct', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} step="any" value={l.vat_rate}
                      onChange={(e) => updateLine(idx, 'vat_rate', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    {lineTotal(l).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-1 py-1 text-center">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((l) => l.filter((_, i) => i !== idx))}
                        className="text-red-500 hover:text-red-700">×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <td colSpan={6} className="px-2 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Grand Total (incl. VAT)</td>
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

export default function NewInvoicePage() {
  return <Suspense><NewInvoiceForm /></Suspense>;
}
