'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Supplier { id: string; code: string; name: string; payment_terms_days: number; }
interface Item { id: string; sku: string; name: string; selling_price: number; }
interface Account { id: string; code: string; name: string; }

interface Line {
  line_type: 'item' | 'gl';
  item_id: string;
  gl_account_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    supplier_id: '',
    po_date: new Date().toISOString().split('T')[0],
    expected_date: '',
    reference: '',
  });

  const [lines, setLines] = useState<Line[]>([
    { line_type: 'item', item_id: '', gl_account_id: '', description: '', quantity: 1, unit_price: 0, vat_rate: 12 },
  ]);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${companyId}&limit=500`)
      .then((r) => setSuppliers(r.data))
      .catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${companyId}&limit=500`)
      .then((r) => setItems(Array.isArray(r) ? r : []))
      .catch(() => {});
    api.get<{ data: Account[] }>(`/gl/accounts?company_id=${companyId}&limit=500`)
      .then((r) => setAccounts(r.data ?? []))
      .catch(() => {});
  }, []);

  function addLine() {
    setLines((l) => [...l, { line_type: 'item', item_id: '', gl_account_id: '', description: '', quantity: 1, unit_price: 0, vat_rate: 12 }]);
  }

  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines((prev) => {
      const next = [...prev];
      const line = { ...next[idx] };
      if (field === 'line_type') {
        line.line_type = val as 'item' | 'gl';
        if (val === 'gl') line.item_id = '';
        if (val === 'item') line.gl_account_id = '';
      } else if (field === 'item_id' && typeof val === 'string') {
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
    const sub = l.quantity * l.unit_price;
    return sub + sub * (l.vat_rate / 100);
  }

  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.supplier_id) { setError('Select a supplier'); return; }
    setSaving(true);
    try {
      const companyId = localStorage.getItem('company_id')!;
      const po = await api.post<{ id: string }>('/purchasing/purchase-orders', {
        company_id: companyId,
        ...form,
        expected_date: form.expected_date || undefined,
        reference: form.reference || undefined,
        lines: lines.map((l) => ({ ...l, item_id: l.line_type === 'item' ? l.item_id || undefined : undefined })),
      });
      router.push(`/dashboard/purchasing/purchase-orders/${po.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create purchase order');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Purchase Order</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Create a draft PO — submit for approval when ready.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">PO Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Supplier *</label>
              <select required value={form.supplier_id}
                onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">PO Date *</label>
              <input required type="date" value={form.po_date}
                onChange={(e) => setForm((f) => ({ ...f, po_date: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Expected Delivery Date</label>
              <input type="date" value={form.expected_date}
                onChange={(e) => setForm((f) => ({ ...f, expected_date: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Reference</label>
              <input type="text" value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Line Items</div>
            <button type="button" onClick={addLine} className="text-xs text-brand-600 hover:underline dark:text-brand-400">+ Add line</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium w-28">Type</th>
                <th className="px-2 py-1.5 text-left font-medium w-44">Account / Item</th>
                <th className="px-2 py-1.5 text-left font-medium">Description *</th>
                <th className="px-2 py-1.5 text-right font-medium w-20">Qty</th>
                <th className="px-2 py-1.5 text-right font-medium w-28">Unit Price</th>
                <th className="px-2 py-1.5 text-right font-medium w-16">VAT %</th>
                <th className="px-2 py-1.5 text-right font-medium w-28">Total</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-2 py-1">
                    <select value={l.line_type} onChange={(e) => updateLine(idx, 'line_type', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="item">Item</option>
                      <option value="gl">GL Account</option>
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    {l.line_type === 'item' ? (
                      <select value={l.item_id} onChange={(e) => updateLine(idx, 'item_id', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        <option value="">Select…</option>
                        {items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                      </select>
                    ) : (
                      <select value={l.gl_account_id} onChange={(e) => updateLine(idx, 'gl_account_id', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        <option value="">Select account…</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <input required type="text" value={l.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0.0001} step="any" value={l.quantity}
                      onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} step="any" value={l.unit_price}
                      onChange={(e) => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} step="any" value={l.vat_rate}
                      onChange={(e) => updateLine(idx, 'vat_rate', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </td>
                  <td className="px-2 py-1 text-right font-mono dark:text-slate-300">
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
              <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
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
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
