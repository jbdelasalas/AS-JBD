'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, type TaggingValues } from '@/components/TaggingPanel';

interface Supplier { id: string; code: string; name: string; }
interface BankAccount { id: string; account_name: string; bank_name: string | null; account_number: string | null; gl_account_id: string | null; }
interface OpenBill { id: string; internal_no: string; bill_no: string; bill_date: string; due_date: string; total: number; balance: number; branch_id: string | null; building_id: string | null; cost_center_id: string | null; grow_reference_id: string | null; }
interface Application { bill_id: string; internal_no: string; amount_applied: number; balance: number; }

function NewPaymentForm() {
  const router = useRouter();
  const params = useSearchParams();
  const preSupplierId = params.get('supplier_id') ?? '';

  const [suppliers, setSuppliers]     = useState<Supplier[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [openBills, setOpenBills]     = useState<OpenBill[]>([]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [loadingBills, setLoadingBills] = useState(false);

  const [form, setForm] = useState({
    supplier_id:    preSupplierId,
    payment_date:   new Date().toISOString().split('T')[0],
    payment_method: 'bank_transfer',
    reference:      '',
    bank_ref:       '',
    check_date:     '',
    amount:         0,
    bank_account_id: '',
    remarks:        '',
  });

  const [apps, setApps] = useState<Application[]>([]);
  const tagData = useTaggingData();
  const [tags, setTags] = useState<TaggingValues>({ branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '' });

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    Promise.all([
      api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${cid}&limit=500`),
      api.get<{ data: BankAccount[] }>(`/bank-accounts?company_id=${cid}`),
    ]).then(([s, b]) => {
      setSuppliers(s.data);
      setBankAccounts(b.data.filter(b => b.gl_account_id));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.supplier_id) { setOpenBills([]); setApps([]); return; }
    setLoadingBills(true);
    api.get<{ bills: OpenBill[] }>(`/ap/suppliers/${form.supplier_id}/outstanding`)
      .then(r => setOpenBills(r.bills))
      .catch(() => {})
      .finally(() => setLoadingBills(false));
  }, [form.supplier_id]);

  function toggleBill(bill: OpenBill) {
    setApps(prev => {
      if (prev.find(a => a.bill_id === bill.id))
        return prev.filter(a => a.bill_id !== bill.id);
      if (prev.length === 0) {
        setTags({
          branch_id:         bill.branch_id         ?? '',
          building_id:       bill.building_id       ?? '',
          cost_center_id:    bill.cost_center_id    ?? '',
          grow_reference_id: bill.grow_reference_id ?? '',
        });
      }
      return [...prev, { bill_id: bill.id, internal_no: bill.internal_no, amount_applied: bill.balance, balance: bill.balance }];
    });
  }

  function updateApp(billId: string, amount: number) {
    setApps(prev => prev.map(a => a.bill_id === billId ? { ...a, amount_applied: amount } : a));
  }

  const totalApplied = apps.reduce((s, a) => s + a.amount_applied, 0);
  const unapplied    = (form.amount || 0) - totalApplied;

  useEffect(() => {
    if (apps.length > 0) setForm(f => ({ ...f, amount: totalApplied }));
  }, [totalApplied]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.supplier_id) { setError('Select a supplier'); return; }
    if (form.amount <= 0)  { setError('Amount must be positive'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const pmt = await api.post<{ id: string }>('/ap/payments', {
        company_id:      cid,
        supplier_id:     form.supplier_id,
        payment_date:    form.payment_date,
        payment_method:  form.payment_method,
        reference:       form.reference   || undefined,
        bank_ref:        form.bank_ref    || undefined,
        check_date:      form.check_date  || undefined,
        remarks:         form.remarks     || undefined,
        amount:          form.amount,
        bank_account_id: bankAccounts.find(b => b.id === form.bank_account_id)?.gl_account_id || undefined,
        bill_ids:        apps.length > 0 ? apps.map(a => a.bill_id) : undefined,
        branch_id:       tags.branch_id         || undefined,
        building_id:     tags.building_id       || undefined,
        cost_center_id:  tags.cost_center_id    || undefined,
        grow_reference_id: tags.grow_reference_id || undefined,
      });
      router.push(`/dashboard/ap/payments/${pmt.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create payment');
    } finally { setSaving(false); }
  }

  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';
  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Supplier Payment</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Record a payment to a supplier and apply it to open bills.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Payment Details</div>
          <div className="grid grid-cols-3 gap-4">

            <div className="col-span-2">
              <label className={lbl}>Supplier *</label>
              <select required value={form.supplier_id}
                onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}
                className={inp}>
                <option value="">Select supplier…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>

            <div>
              <label className={lbl}>Payment Date *</label>
              <input required type="date" value={form.payment_date}
                onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))}
                className={inp} />
            </div>

            <div>
              <label className={lbl}>Payment Method *</label>
              <select value={form.payment_method}
                onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                className={inp}>
                {['cash','check','bank_transfer'].map(m => (
                  <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={lbl}>Amount Paid *</label>
              <input required type="number" min={0.01} step="any" value={form.amount || ''}
                onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                className={`${inp} text-right`} />
            </div>

            <div>
              <label className={lbl}>Reference / Check no.</label>
              <input type="text" value={form.reference}
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                className={inp} />
            </div>

            {['check','bank_transfer'].includes(form.payment_method) && (
              <>
                <div>
                  <label className={lbl}>Bank Ref / Trx ID</label>
                  <input type="text" value={form.bank_ref}
                    onChange={e => setForm(f => ({ ...f, bank_ref: e.target.value }))}
                    className={inp} />
                </div>
                {form.payment_method === 'check' && (
                  <div>
                    <label className={lbl}>Check Date</label>
                    <input type="date" value={form.check_date}
                      onChange={e => setForm(f => ({ ...f, check_date: e.target.value }))}
                      className={inp} />
                  </div>
                )}
              </>
            )}

            <div>
              <label className={lbl}>Bank / Cash Account</label>
              <select value={form.bank_account_id}
                onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))}
                className={inp}>
                <option value="">— auto-resolve —</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.account_name}{b.bank_name ? ` — ${b.bank_name}` : ''}{b.account_number ? ` (${b.account_number})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-3">
              <label className={lbl}>Remarks</label>
              <textarea rows={2} value={form.remarks}
                onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                className={inp} />
            </div>
          </div>
        </div>

        {/* Apply to bills */}
        {form.supplier_id && (
          <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Apply to Bills</div>
              {apps.length > 0 && (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Applied: {formatPHP(totalApplied)} ·
                  <span className={unapplied < -0.001 ? 'text-red-600 font-semibold ml-1' : 'ml-1'}>
                    Unapplied: {formatPHP(Math.max(unapplied, 0))}
                  </span>
                </div>
              )}
            </div>

            {loadingBills ? (
              <div className="py-3 text-center text-xs text-slate-500">Loading open bills…</div>
            ) : openBills.length === 0 ? (
              <div className="py-3 text-center text-xs text-slate-500">No open bills for this supplier.</div>
            ) : (
              <table className="min-w-full text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="w-8 px-2 py-1.5" />
                    <th className="px-2 py-1.5 text-left font-medium">Internal No.</th>
                    <th className="px-2 py-1.5 text-left font-medium">Bill No.</th>
                    <th className="px-2 py-1.5 text-left font-medium">Bill Date</th>
                    <th className="px-2 py-1.5 text-left font-medium">Due Date</th>
                    <th className="px-2 py-1.5 text-right font-medium">Balance</th>
                    <th className="px-2 py-1.5 text-right font-medium">Apply Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {openBills.map(b => {
                    const app = apps.find(a => a.bill_id === b.id);
                    return (
                      <tr key={b.id} className={`border-b border-slate-100 dark:border-slate-700 ${app ? 'bg-brand-50 dark:bg-brand-950' : ''}`}>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={!!app} onChange={() => toggleBill(b)} />
                        </td>
                        <td className="px-2 py-1 font-mono text-brand-700 dark:text-brand-400">{b.internal_no}</td>
                        <td className="px-2 py-1 font-mono text-slate-500 dark:text-slate-400">{b.bill_no}</td>
                        <td className="px-2 py-1 text-slate-600 dark:text-slate-400">{formatDate(b.bill_date)}</td>
                        <td className="px-2 py-1 text-slate-600 dark:text-slate-400">{formatDate(b.due_date)}</td>
                        <td className="px-2 py-1 text-right font-mono font-semibold text-amber-700 dark:text-amber-400">{formatPHP(b.balance)}</td>
                        <td className="px-2 py-1 text-right">
                          {app ? (
                            <input type="number" min={0.01} max={b.balance} step="any"
                              value={app.amount_applied}
                              onChange={e => updateApp(b.id, parseFloat(e.target.value) || 0)}
                              className="w-28 rounded border border-slate-300 px-1 py-0.5 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
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
