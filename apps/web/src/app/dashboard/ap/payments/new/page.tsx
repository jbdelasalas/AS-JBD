'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, type TaggingValues } from '@/components/TaggingPanel';

interface Supplier { id: string; code: string; name: string; }
interface BankAccount { id: string; account_name: string; bank_name: string | null; account_number: string | null; gl_account_id: string | null; }
interface OpenBill {
  id: string;
  internal_no: string;
  bill_no: string;
  bill_date: string;
  due_date: string;
  total: number;
  balance: number;
}

function NewPaymentForm() {
  const router = useRouter();
  const params = useSearchParams();
  const preSupplierId = params.get('supplier_id') ?? '';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [openBills, setOpenBills] = useState<OpenBill[]>([]);
  const [selectedBills, setSelectedBills] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingBills, setLoadingBills] = useState(false);

  const [form, setForm] = useState({
    supplier_id: preSupplierId,
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'bank_transfer',
    reference: '',
    remarks: '',
    amount: '',
    bank_account_id: '',
  });
  const tagData = useTaggingData();
  const [tags, setTags] = useState<TaggingValues>({ branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '' });

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${companyId}&limit=500`),
      api.get<{ data: BankAccount[] }>(`/bank-accounts?company_id=${companyId}`),
    ]).then(([s, b]) => {
      setSuppliers(s.data);
      setBankAccounts(b.data.filter((b) => b.gl_account_id));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.supplier_id) { setOpenBills([]); return; }
    setLoadingBills(true);
    api.get<{ bills: OpenBill[] }>(`/ap/suppliers/${form.supplier_id}/outstanding`)
      .then((r) => setOpenBills(r.bills))
      .catch(() => {})
      .finally(() => setLoadingBills(false));
  }, [form.supplier_id]);

  function toggleBill(id: string) {
    setSelectedBills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const suggestedAmount = openBills
    .filter((b) => selectedBills.has(b.id))
    .reduce((s, b) => s + b.balance, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.supplier_id) { setError('Select a supplier'); return; }
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return; }
    setSaving(true);
    try {
      const companyId = localStorage.getItem('company_id')!;
      const pmt = await api.post<{ id: string }>('/ap/payments', {
        company_id: companyId,
        supplier_id: form.supplier_id,
        payment_date: form.payment_date,
        payment_method: form.payment_method,
        reference: form.reference || undefined,
        remarks: form.remarks || undefined,
        amount,
        bank_account_id: bankAccounts.find((b) => b.id === form.bank_account_id)?.gl_account_id || undefined,
        bill_ids: [...selectedBills],
        branch_id: tags.branch_id || undefined,
        building_id: tags.building_id || undefined,
        cost_center_id: tags.cost_center_id || undefined,
        grow_reference_id: tags.grow_reference_id || undefined,
      });
      router.push(`/dashboard/ap/payments/${pmt.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Supplier Payment</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Record a payment to a supplier. Optionally apply against open bills.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Payment Details</div>
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
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Payment Date *</label>
              <input required type="date" value={form.payment_date}
                onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Payment Method</label>
              <select value={form.payment_method}
                onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Amount *</label>
              <input required type="number" min={0.01} step="any" value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder={suggestedAmount > 0 ? suggestedAmount.toFixed(2) : '0.00'}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              {suggestedAmount > 0 && !form.amount && (
                <button type="button" onClick={() => setForm((f) => ({ ...f, amount: suggestedAmount.toFixed(2) }))}
                  className="mt-0.5 text-[11px] text-brand-600 hover:underline dark:text-brand-400">
                  Use {formatPHP(suggestedAmount)}
                </button>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Bank / Cash Account</label>
              <select value={form.bank_account_id}
                onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">— select —</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.account_name}{b.bank_name ? ` — ${b.bank_name}` : ''}{b.account_number ? ` (${b.account_number})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Reference (check no. etc.)</label>
              <input type="text" value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Remarks</label>
              <textarea value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                rows={2}
                placeholder="Optional notes or remarks for this payment"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 resize-none" />
            </div>
          </div>
        </div>

        {form.supplier_id && (
          <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">Apply Against Open Bills (optional)</div>
            {loadingBills ? (
              <div className="py-3 text-center text-xs text-slate-500">Loading open bills…</div>
            ) : openBills.length === 0 ? (
              <div className="py-3 text-center text-xs text-slate-500">No open bills for this supplier.</div>
            ) : (
              <table className="min-w-full text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="w-8 px-2 py-1.5" />
                    <th className="px-2 py-1.5 text-left font-medium">Internal no.</th>
                    <th className="px-2 py-1.5 text-left font-medium">Supplier Bill no.</th>
                    <th className="px-2 py-1.5 text-left font-medium">Bill Date</th>
                    <th className="px-2 py-1.5 text-left font-medium">Due Date</th>
                    <th className="px-2 py-1.5 text-right font-medium">Total</th>
                    <th className="px-2 py-1.5 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {openBills.map((b) => (
                    <tr key={b.id} className={`border-b border-slate-100 dark:border-slate-700 ${selectedBills.has(b.id) ? 'bg-brand-50 dark:bg-brand-950' : ''}`}>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={selectedBills.has(b.id)}
                          onChange={() => toggleBill(b.id)} />
                      </td>
                      <td className="px-2 py-1.5 font-mono dark:text-slate-300">{b.internal_no}</td>
                      <td className="px-2 py-1.5 font-mono text-slate-500 dark:text-slate-400">{b.bill_no}</td>
                      <td className="px-2 py-1.5 dark:text-slate-400">{formatDate(b.bill_date)}</td>
                      <td className="px-2 py-1.5 dark:text-slate-400">{formatDate(b.due_date)}</td>
                      <td className="px-2 py-1.5 text-right font-mono dark:text-slate-300">{formatPHP(b.total)}</td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold text-amber-700 dark:text-amber-400">{formatPHP(b.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
          <TaggingFields value={tags} data={tagData} onChange={(f, v) => setTags(t => ({ ...t, [f]: v }))} />
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Payment'}
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

export default function NewPaymentPage() {
  return <Suspense><NewPaymentForm /></Suspense>;
}
