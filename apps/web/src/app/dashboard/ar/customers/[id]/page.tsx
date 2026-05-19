'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { Customer } from '@perpet/shared';

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
}

interface Payment {
  id: string;
  receipt_no: string;
  payment_date: string;
  payment_method: string;
  amount: number;
  status: string;
}

const SI_STATUS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:text-slate-400',
  open: 'bg-blue-100 text-blue-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500 dark:text-slate-400',
};

const CUSTOMER_TYPES = ['wholesale', 'fleet', 'gov', 'retail'];

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<(Customer & { open_ar_balance: number }) | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Customer>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') ?? '' : '';

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<Customer & { open_ar_balance: number }>(`/ar/customers/${id}`),
      api.get<InvoiceRow[]>(`/ar/customers/${id}/outstanding`),
      api.get<{ data: Payment[] }>(`/ar/collections?company_id=${companyId}&customer_id=${id}&limit=20`),
    ]).then(([c, inv, pay]) => {
      setCustomer(c);
      setInvoices(inv);
      setPayments(pay.data);
      setForm(c);
    }).finally(() => setLoading(false));
  }, [id, companyId]);

  useEffect(() => { load(); }, [load]);

  function set(field: string, val: unknown) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/ar/customers/${id}`, {
        name: form.name,
        customer_type: form.customer_type,
        tin: form.tin || null,
        address: form.address || null,
        contact_person: form.contact_person || null,
        email: form.email || null,
        phone: form.phone || null,
        payment_terms_days: Number(form.payment_terms_days),
        credit_limit: Number(form.credit_limit),
        is_vat_exempt: form.is_vat_exempt,
        is_active: form.is_active,
      });
      setSaved(true);
      setEditing(false);
      load();
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  if (!customer) return <div className="py-10 text-center text-sm text-red-600">Customer not found</div>;

  const creditUsedPct = customer.credit_limit > 0
    ? Math.min((customer.open_ar_balance / customer.credit_limit) * 100, 100)
    : 0;

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{customer.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{customer.code} · {customer.customer_type}</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Edit
            </button>
          )}
          <Link href={`/dashboard/ar/invoices/new?customer_id=${id}`}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            New Invoice
          </Link>
        </div>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {editing ? (
        <form onSubmit={save} className="mb-5 rounded-lg border border-brand-200 dark:border-brand-800 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Edit Customer</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className={lbl}>Name *</label>
              <input required value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Type</label>
              <select value={form.customer_type ?? 'wholesale'} onChange={(e) => set('customer_type', e.target.value)} className={inp}>
                {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>TIN</label>
              <input value={form.tin ?? ''} onChange={(e) => set('tin', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Phone</label>
              <input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Email</label>
              <input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Contact Person</label>
              <input value={form.contact_person ?? ''} onChange={(e) => set('contact_person', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Payment Terms (days)</label>
              <input type="number" min={0} value={form.payment_terms_days ?? 30}
                onChange={(e) => set('payment_terms_days', parseInt(e.target.value))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Credit Limit</label>
              <input type="number" min={0} step="any" value={form.credit_limit ?? 0}
                onChange={(e) => set('credit_limit', parseFloat(e.target.value))} className={inp} />
            </div>
            <div className="col-span-3">
              <label className={lbl}>Address</label>
              <input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} className={inp} />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={form.is_vat_exempt ?? false} onChange={(e) => set('is_vat_exempt', e.target.checked)} />
                VAT Exempt
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={form.is_active ?? true} onChange={(e) => set('is_active', e.target.checked)} />
                Active
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit" disabled={saving}
              className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setForm(customer); setError(null); }}
              className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mb-5 grid grid-cols-3 gap-4">
          <div className="col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">Contact</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ['TIN', customer.tin ?? '—'],
                ['Contact', customer.contact_person ?? '—'],
                ['Phone', customer.phone ?? '—'],
                ['Email', customer.email ?? '—'],
                ['Address', customer.address ?? '—'],
                ['VAT Exempt', customer.is_vat_exempt ? 'Yes' : 'No'],
              ].map(([k, v]) => (
                <div key={k}>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{k}: </span>
                  <span className="text-slate-800 dark:text-slate-200">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">AR Status</div>
            <div className="mb-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Open Balance</div>
              <div className="text-xl font-bold text-amber-700">{formatPHP(customer.open_ar_balance)}</div>
            </div>
            {customer.credit_limit > 0 && (
              <>
                <div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Credit used</span>
                  <span>{creditUsedPct.toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100">
                  <div
                    className={`h-2 rounded-full ${creditUsedPct >= 90 ? 'bg-red-500' : creditUsedPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${creditUsedPct}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Limit: {formatPHP(customer.credit_limit)} · Available: {formatPHP(Math.max(customer.credit_limit - customer.open_ar_balance, 0))}
                </div>
              </>
            )}
            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Payment terms: {customer.payment_terms_days} days
            </div>
          </div>
        </div>
      )}

      {/* Outstanding invoices */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white">
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          Outstanding Invoices
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Invoice</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">Paid</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">No outstanding invoices.</td></tr>
            ) : invoices.map((inv) => (
              <tr key={inv.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/ar/invoices/${inv.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                    {inv.invoice_no}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(inv.invoice_date)}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(inv.due_date)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(inv.total)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(inv.amount_paid)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{formatPHP(inv.balance)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${SI_STATUS[inv.status] ?? SI_STATUS.open}`}>
                    {inv.status.replace(/_/g, ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payment History */}
      <div className="mt-5 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          Payment History
        </div>
        {payments.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-400">No payments recorded yet.</div>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Receipt No.</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Method</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/ar/collections/${p.id}`} className="text-brand-700 hover:underline dark:text-brand-400">{p.receipt_no}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatDate(p.payment_date)}</td>
                  <td className="px-3 py-2 capitalize text-slate-600 dark:text-slate-400">{p.payment_method?.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700">{formatPHP(p.amount)}</td>
                  <td className="px-3 py-2 capitalize text-slate-500 dark:text-slate-400">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
