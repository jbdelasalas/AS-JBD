'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Supplier { id: string; code: string; name: string; payment_terms_days: number; ewt_rate: number; }
interface Account { id: string; code: string; name: string; }
interface POOption { id: string; po_no: string; }

interface Line {
  line_type: 'item' | 'service';
  item_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  ewt_rate: number;
  expense_account_id: string;
}

function NewBillForm() {
  const router = useRouter();
  const params = useSearchParams();
  const prePoId = params.get('po_id') ?? '';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pos, setPos] = useState<POOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    supplier_id: '',
    bill_no: '',
    bill_date: new Date().toISOString().split('T')[0],
    due_date: '',
    po_id: prePoId,
  });

  const [lines, setLines] = useState<Line[]>([
    { line_type: 'service', item_id: '', description: '', quantity: 1, unit_price: 0, vat_rate: 12, ewt_rate: 0, expense_account_id: '' },
  ]);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${companyId}&limit=500`),
      api.get<{ data: Account[] }>(`/gl/accounts?company_id=${companyId}&limit=500`),
      api.get<{ data: POOption[] }>(`/purchasing/purchase-orders?company_id=${companyId}&status=approved&limit=500`),
    ]).then(([s, a, p]) => {
      setSuppliers(s.data);
      setAccounts(a.data);
      setPos(p.data);
    }).catch(() => {});
  }, []);

  const currentEwtRate = lines[0]?.ewt_rate ?? 0;

  function addLine() {
    setLines((l) => [...l, { line_type: 'service', item_id: '', description: '', quantity: 1, unit_price: 0, vat_rate: 12, ewt_rate: currentEwtRate, expense_account_id: '' }]);
  }

  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  }

  function lineSubtotal(l: Line) { return l.quantity * l.unit_price; }
  function lineTotal(l: Line) { const sub = lineSubtotal(l); return sub + sub * (l.vat_rate / 100); }
  function lineEwt(l: Line) { return lineSubtotal(l) * (l.ewt_rate / 100); }

  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const totalEwt = lines.reduce((s, l) => s + lineEwt(l), 0);
  const netPayable = grandTotal - totalEwt;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.supplier_id) { setError('Select a supplier'); return; }
    if (!form.bill_no) { setError('Supplier invoice number is required'); return; }
    setSaving(true);
    try {
      const companyId = localStorage.getItem('company_id')!;
      const bill = await api.post<{ id: string }>('/ap/bills', {
        company_id: companyId,
        ...form,
        due_date: form.due_date || undefined,
        po_id: form.po_id || undefined,
        lines: lines.map((l) => ({
          ...l,
          item_id: l.item_id || undefined,
          expense_account_id: l.expense_account_id || undefined,
        })),
      });
      router.push(`/dashboard/ap/bills/${bill.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create bill');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Bill</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Enter a vendor invoice as a draft bill.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Bill Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Supplier *</label>
              <select required value={form.supplier_id}
                onChange={(e) => {
                  const s = suppliers.find((x) => x.id === e.target.value);
                  setForm((f) => ({ ...f, supplier_id: e.target.value }));
                  if (s) {
                    if (!form.due_date) {
                      const d = new Date(form.bill_date);
                      d.setDate(d.getDate() + s.payment_terms_days);
                      setForm((f) => ({ ...f, supplier_id: e.target.value, due_date: d.toISOString().split('T')[0] }));
                    }
                    setLines((prev) => prev.map((l) => ({ ...l, ewt_rate: s.ewt_rate ?? 0 })));
                  }
                }}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Supplier Invoice no. *</label>
              <input required type="text" value={form.bill_no}
                onChange={(e) => setForm((f) => ({ ...f, bill_no: e.target.value }))}
                placeholder="e.g. INV-2026-001"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Bill Date *</label>
              <input required type="date" value={form.bill_date}
                onChange={(e) => setForm((f) => ({ ...f, bill_date: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Due Date</label>
              <input type="date" value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Linked PO</label>
              <select value={form.po_id}
                onChange={(e) => setForm((f) => ({ ...f, po_id: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">— none —</option>
                {pos.map((p) => <option key={p.id} value={p.id}>{p.po_no}</option>)}
              </select>
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
                <th className="px-2 py-1.5 text-left font-medium w-24">Type</th>
                <th className="px-2 py-1.5 text-left font-medium">Description *</th>
                <th className="px-2 py-1.5 text-left font-medium w-36">Expense Account</th>
                <th className="px-2 py-1.5 text-right font-medium w-20">Qty</th>
                <th className="px-2 py-1.5 text-right font-medium w-28">Unit Price</th>
                <th className="px-2 py-1.5 text-right font-medium w-16">VAT %</th>
                <th className="px-2 py-1.5 text-right font-medium w-16">EWT %</th>
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
                      <option value="service">Service</option>
                      <option value="item">Item</option>
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input required type="text" value={l.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </td>
                  <td className="px-2 py-1">
                    <select value={l.expense_account_id}
                      onChange={(e) => updateLine(idx, 'expense_account_id', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="">— none —</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                    </select>
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
                  <td className="px-2 py-1">
                    <input type="number" min={0} step="any" value={l.ewt_rate}
                      onChange={(e) => updateLine(idx, 'ewt_rate', parseFloat(e.target.value) || 0)}
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
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={7} className="px-2 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">Grand Total (incl. VAT)</td>
                <td className="px-2 py-1.5 text-right font-mono text-xs text-slate-700 dark:text-slate-300">
                  ₱{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
              {totalEwt > 0 && (
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <td colSpan={7} className="px-2 py-1.5 text-right text-xs text-amber-700 dark:text-amber-400">Less: EWT (Withheld)</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-amber-700 dark:text-amber-400">
                    ({totalEwt.toLocaleString('en-PH', { minimumFractionDigits: 2 })})
                  </td>
                  <td />
                </tr>
              )}
              <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <td colSpan={7} className="px-2 py-2 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">Net Payable to Supplier</td>
                <td className="px-2 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                  ₱{netPayable.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
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

export default function NewBillPage() {
  return <Suspense><NewBillForm /></Suspense>;
}
