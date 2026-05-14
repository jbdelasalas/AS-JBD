'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface CompanyDetail {
  id: string; code: string; name: string; trade_name: string | null;
  tin: string | null; vat_status: string | null; rdo_code: string | null;
  business_style: string | null; registered_address: string | null;
  registration_date: string | null; books_start_date: string | null;
  accounting_method: string; fiscal_year_start_month: number;
  is_active: boolean; created_at: string; updated_at: string;
  branches: Array<{ id: string; code: string; name: string; is_active: boolean }>;
}

const VAT_OPTIONS = ['VAT_REGISTERED', 'NON_VAT', 'EXEMPT'];
const METHOD_OPTIONS = ['ACCRUAL', 'CASH'];

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [form, setForm] = useState<Partial<CompanyDetail>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<CompanyDetail>(`/admin/companies/${id}`)
      .then((c) => { setCompany(c); setForm(c); })
      .catch((e) => setError(e.message));
  }, [id]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/admin/companies/${id}`, form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const f = (label: string, key: keyof CompanyDetail, type = 'text') => (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</label>
      <input type={type} value={(form[key] as string) ?? ''}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
    </div>
  );

  if (!company) return <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{error ?? 'Loading…'}</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{company.name}</h1>
        <div className="flex gap-2">
          <button onClick={() => router.back()}
            className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
            Back
          </button>
          <button onClick={save} disabled={saving}
            className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-2 gap-4">
          {f('Company name', 'name')}
          {f('Trade name', 'trade_name')}
          {f('TIN', 'tin')}
          {f('RDO Code', 'rdo_code')}
          {f('Business style', 'business_style')}
          {f('Registration date', 'registration_date', 'date')}
          {f('Books start date', 'books_start_date', 'date')}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">VAT status</label>
            <select value={form.vat_status ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, vat_status: e.target.value }))}
              className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100">
              <option value="">— select —</option>
              {VAT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Accounting method</label>
            <select value={form.accounting_method ?? 'ACCRUAL'}
              onChange={(e) => setForm((p) => ({ ...p, accounting_method: e.target.value }))}
              className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100">
              {METHOD_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Registered address</label>
          <textarea value={form.registered_address ?? ''} rows={2}
            onChange={(e) => setForm((p) => ({ ...p, registered_address: e.target.value }))}
            className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
      </div>

      {/* Branches */}
      <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Branches</h2>
        {company.branches.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No branches yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-xs text-slate-500 dark:text-slate-400">
              <tr>
                <th className="pb-1 text-left font-medium">Code</th>
                <th className="pb-1 text-left font-medium">Name</th>
                <th className="pb-1 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {company.branches.map((b) => (
                <tr key={b.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="py-1.5 font-mono text-xs text-slate-700 dark:text-slate-300">{b.code}</td>
                  <td className="py-1.5 text-xs text-slate-900 dark:text-slate-100">{b.name}</td>
                  <td className="py-1.5">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${b.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500 dark:text-slate-400'}`}>
                      {b.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
