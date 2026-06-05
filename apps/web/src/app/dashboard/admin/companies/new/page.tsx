'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const VAT_OPTIONS = ['VAT_REGISTERED', 'NON_VAT', 'EXEMPT'];
const METHOD_OPTIONS = ['ACCRUAL', 'CASH'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface FormState {
  code: string;
  name: string;
  trade_name: string;
  tin: string;
  vat_status: string;
  rdo_code: string;
  business_style: string;
  registered_address: string;
  registration_date: string;
  books_start_date: string;
  accounting_method: string;
  fiscal_year_start_month: number;
}

const EMPTY: FormState = {
  code: '',
  name: '',
  trade_name: '',
  tin: '',
  vat_status: '',
  rdo_code: '',
  business_style: '',
  registered_address: '',
  registration_date: '',
  books_start_date: '',
  accounting_method: 'ACCRUAL',
  fiscal_year_start_month: 1,
};

export default function NewCompanyPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof FormState, value: string | number) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        trade_name: form.trade_name || null,
        tin: form.tin || null,
        vat_status: form.vat_status || null,
        rdo_code: form.rdo_code || null,
        business_style: form.business_style || null,
        registered_address: form.registered_address || null,
        registration_date: form.registration_date || null,
        books_start_date: form.books_start_date || null,
      };
      const res = await api.post<{ id: string }>('/admin/companies', payload);
      router.push(`/dashboard/admin/companies/${res.id}`);
    } catch (e: unknown) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const field = (label: string, key: keyof FormState, type = 'text', required = false) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value)}
        required={required}
        className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
      />
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">New Company</h1>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <form onSubmit={submit}>
        <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">

          <div className="grid grid-cols-2 gap-4">
            {field('Code', 'code', 'text', true)}
            {field('Company name', 'name', 'text', true)}
            {field('Trade name', 'trade_name')}
            {field('Business style', 'business_style')}
            {field('TIN', 'tin')}
            {field('RDO Code', 'rdo_code')}
            {field('Registration date', 'registration_date', 'date')}
            {field('Books start date', 'books_start_date', 'date')}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">VAT status</label>
              <select
                value={form.vat_status}
                onChange={(e) => set('vat_status', e.target.value)}
                className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="">— select —</option>
                {VAT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Accounting method</label>
              <select
                value={form.accounting_method}
                onChange={(e) => set('accounting_method', e.target.value)}
                className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100"
              >
                {METHOD_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Fiscal year start</label>
              <select
                value={form.fiscal_year_start_month}
                onChange={(e) => set('fiscal_year_start_month', parseInt(e.target.value))}
                className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100"
              >
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Registered address</label>
            <textarea
              value={form.registered_address}
              rows={2}
              onChange={(e) => set('registered_address', e.target.value)}
              className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Company'}
          </button>
        </div>
      </form>
    </div>
  );
}
