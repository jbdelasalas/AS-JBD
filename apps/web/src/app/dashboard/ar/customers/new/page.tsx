'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function NewCustomerPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    code: '',
    name: '',
    customer_type: 'wholesale',
    tin: '',
    address: '',
    contact_person: '',
    email: '',
    phone: '',
    payment_terms_days: 30,
    credit_limit: 0,
    is_vat_exempt: false,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const companyId = localStorage.getItem('company_id')!;
      const customer = await api.post<{ id: string }>('/ar/customers', {
        company_id: companyId,
        ...form,
        tin: form.tin || undefined,
        address: form.address || undefined,
        contact_person: form.contact_person || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
      });
      router.push(`/dashboard/ar/customers/${customer.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create customer');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">New Customer</h1>
      <p className="mb-5 text-sm text-slate-600">Create a new customer account.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Customer Code *</label>
              <input required type="text" value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="CUST-001"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Customer Name *</label>
              <input required type="text" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Type</label>
              <select value={form.customer_type}
                onChange={(e) => setForm((f) => ({ ...f, customer_type: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                {['wholesale','retail','fleet','gov'].map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">TIN</label>
              <input type="text" value={form.tin}
                onChange={(e) => setForm((f) => ({ ...f, tin: e.target.value }))}
                placeholder="123-456-789-000"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Contact Person</label>
              <input type="text" value={form.contact_person}
                onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
              <input type="email" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
              <input type="text" value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Payment Terms (days)</label>
              <input type="number" min={0} value={form.payment_terms_days}
                onChange={(e) => setForm((f) => ({ ...f, payment_terms_days: parseInt(e.target.value) }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Credit Limit (₱)</label>
              <input type="number" min={0} step="any" value={form.credit_limit}
                onChange={(e) => setForm((f) => ({ ...f, credit_limit: parseFloat(e.target.value) || 0 }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
              <p className="mt-0.5 text-[11px] text-slate-500">Set 0 for unlimited</p>
            </div>

            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">Address</label>
              <textarea rows={2} value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="vat_exempt" checked={form.is_vat_exempt}
                onChange={(e) => setForm((f) => ({ ...f, is_vat_exempt: e.target.checked }))} />
              <label htmlFor="vat_exempt" className="text-sm text-slate-700">VAT Exempt Customer</label>
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Customer'}
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
