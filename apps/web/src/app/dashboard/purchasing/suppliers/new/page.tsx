'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function NewSupplierPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    supplier_type: 'trade',
    tin: '',
    address: '',
    contact_person: '',
    email: '',
    phone: '',
    payment_terms_days: 30,
    is_vat_registered: true,
    ewt_rate: 0,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const companyId = localStorage.getItem('company_id')!;
      const supplier = await api.post<{ id: string }>('/ap/suppliers', {
        company_id: companyId,
        ...form,
        tin: form.tin || undefined,
        address: form.address || undefined,
        contact_person: form.contact_person || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
      });
      router.push(`/dashboard/purchasing/suppliers/${supplier.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create supplier');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Supplier</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Create a new vendor/supplier record.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Supplier Name *</label>
              <input required type="text" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Type</label>
              <select value={form.supplier_type}
                onChange={(e) => setForm((f) => ({ ...f, supplier_type: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                {['trade','utility','service','refinery'].map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">TIN</label>
              <input type="text" value={form.tin}
                onChange={(e) => setForm((f) => ({ ...f, tin: e.target.value }))}
                placeholder="123-456-789-000"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Contact Person</label>
              <input type="text" value={form.contact_person}
                onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Email</label>
              <input type="email" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Phone</label>
              <input type="text" value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Payment Terms (days)</label>
              <input type="number" min={0} value={form.payment_terms_days}
                onChange={(e) => setForm((f) => ({ ...f, payment_terms_days: parseInt(e.target.value) }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">EWT Rate (%)</label>
              <input type="number" min={0} max={100} step="0.01" value={form.ewt_rate}
                onChange={(e) => setForm((f) => ({ ...f, ewt_rate: parseFloat(e.target.value) || 0 }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Address</label>
              <textarea rows={2} value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="vat_reg" checked={form.is_vat_registered}
                onChange={(e) => setForm((f) => ({ ...f, is_vat_registered: e.target.checked }))} />
              <label htmlFor="vat_reg" className="text-sm text-slate-700 dark:text-slate-300">VAT Registered Supplier</label>
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Supplier'}
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
