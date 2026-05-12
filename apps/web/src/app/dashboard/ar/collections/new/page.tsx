'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';

interface Customer { id: string; code: string; name: string; }
interface InvoiceRow { id: string; invoice_no: string; due_date: string; balance: number; status: string; }
interface BankAccount { id: string; code: string; name: string; account_type?: string; }

interface Application { invoice_id: string; invoice_no: string; amount_applied: number; balance: number; }

export default function NewCollectionPage() {
  const router = useRouter();
  const params = useSearchParams();
  const preCustomerId = params.get('customer_id') ?? '';
  const preInvoiceId = params.get('invoice_id') ?? '';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [openInvoices, setOpenInvoices] = useState<InvoiceRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    customer_id: preCustomerId,
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'cash',
    reference: '',
    bank_ref: '',
    check_date: '',
    amount: 0,
    bank_account_id: '',
    notes: '',
  });

  const [apps, setApps] = useState<Application[]>([]);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<{ data: Customer[] }>(`/ar/customers?company_id=${companyId}&is_active=true&limit=200`),
      api.get<{ data: BankAccount[] }>(`/gl/accounts?company_id=${companyId}&limit=200`),
    ]).then(([c, a]) => {
      setCustomers(c.data);
      setAccounts(a.data.filter((x) => x.account_type === 'ASSET'));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.customer_id) { setOpenInvoices([]); setApps([]); return; }
    api.get<InvoiceRow[]>(`/ar/customers/${form.customer_id}/outstanding`)
      .then((inv) => {
        setOpenInvoices(inv);
        if (preInvoiceId) {
          const found = inv.find((i) => i.id === preInvoiceId);
          if (found) {
            setApps([{ invoice_id: found.id, invoice_no: found.invoice_no, amount_applied: found.balance, balance: found.balance }]);
          }
        }
      })
      .catch(() => {});
  }, [form.customer_id, preInvoiceId]);

  function toggleInvoice(inv: InvoiceRow) {
    setApps((prev) => {
      if (prev.find((a) => a.invoice_id === inv.id)) {
        return prev.filter((a) => a.invoice_id !== inv.id);
      }
      return [...prev, { invoice_id: inv.id, invoice_no: inv.invoice_no, amount_applied: inv.balance, balance: inv.balance }];
    });
  }

  function updateApp(invoiceId: string, amount: number) {
    setApps((prev) => prev.map((a) => a.invoice_id === invoiceId ? { ...a, amount_applied: amount } : a));
  }

  const totalApplied = apps.reduce((s, a) => s + a.amount_applied, 0);
  const unapplied = (form.amount || 0) - totalApplied;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.customer_id) { setError('Select a customer'); return; }
    if (form.amount <= 0) { setError('Amount must be positive'); return; }
    setSaving(true);
    try {
      const companyId = localStorage.getItem('company_id')!;
      const pmt = await api.post<{ id: string }>('/ar/collections', {
        company_id: companyId,
        customer_id: form.customer_id,
        payment_date: form.payment_date,
        payment_method: form.payment_method,
        reference: form.reference || undefined,
        bank_ref: form.bank_ref || undefined,
        check_date: form.check_date || undefined,
        amount: form.amount,
        bank_account_id: form.bank_account_id || undefined,
        notes: form.notes || undefined,
        applications: apps.length > 0 ? apps.map((a) => ({ invoice_id: a.invoice_id, amount_applied: a.amount_applied })) : undefined,
      });
      router.push(`/dashboard/ar/collections/${pmt.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">New Collection</h1>
      <p className="mb-5 text-sm text-slate-600">Record a customer payment and apply it to invoices.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-4 text-sm font-medium text-slate-700">Payment Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Customer *</label>
              <select required value={form.customer_id}
                onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">Select customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Payment Date *</label>
              <input required type="date" value={form.payment_date}
                onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Payment Method *</label>
              <select value={form.payment_method}
                onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                {['cash','check','bank_transfer','credit_card','online'].map((m) => (
                  <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Amount Received *</label>
              <input required type="number" min={0.01} step="any" value={form.amount || ''}
                onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-right" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Reference / Check no.</label>
              <input type="text" value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>

            {['check','bank_transfer'].includes(form.payment_method) && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Bank Ref / Trx ID</label>
                  <input type="text" value={form.bank_ref}
                    onChange={(e) => setForm((f) => ({ ...f, bank_ref: e.target.value }))}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                </div>
                {form.payment_method === 'check' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Check Date</label>
                    <input type="date" value={form.check_date}
                      onChange={(e) => setForm((f) => ({ ...f, check_date: e.target.value }))}
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  </div>
                )}
              </>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Bank / Cash Account</label>
              <select value={form.bank_account_id}
                onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">— auto-resolve —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>

            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
              <textarea rows={2} value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
          </div>
        </div>

        {/* Apply to invoices */}
        {openInvoices.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-700">Apply to Invoices</div>
              <div className="text-xs text-slate-500">
                Applied: {formatPHP(totalApplied)} ·
                <span className={unapplied < -0.001 ? 'text-red-600 font-semibold ml-1' : 'ml-1'}>
                  Unapplied: {formatPHP(Math.max(unapplied, 0))}
                </span>
              </div>
            </div>

            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="w-8 px-2 py-1.5" />
                  <th className="px-2 py-1.5 text-left font-medium">Invoice</th>
                  <th className="px-2 py-1.5 text-left font-medium">Due</th>
                  <th className="px-2 py-1.5 text-right font-medium">Balance</th>
                  <th className="px-2 py-1.5 text-right font-medium">Apply amount</th>
                </tr>
              </thead>
              <tbody>
                {openInvoices.map((inv) => {
                  const app = apps.find((a) => a.invoice_id === inv.id);
                  return (
                    <tr key={inv.id} className="border-b border-slate-100">
                      <td className="px-2 py-1 text-center">
                        <input type="checkbox" checked={!!app}
                          onChange={() => toggleInvoice(inv)} />
                      </td>
                      <td className="px-2 py-1 font-mono text-brand-700">{inv.invoice_no}</td>
                      <td className="px-2 py-1 text-slate-600">{inv.due_date}</td>
                      <td className="px-2 py-1 text-right font-mono font-semibold">{formatPHP(inv.balance)}</td>
                      <td className="px-2 py-1 text-right">
                        {app ? (
                          <input type="number" min={0.01} max={inv.balance} step="any"
                            value={app.amount_applied}
                            onChange={(e) => updateApp(inv.id, parseFloat(e.target.value) || 0)}
                            className="w-28 rounded border border-slate-300 px-1 py-0.5 text-right" />
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Collection'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
