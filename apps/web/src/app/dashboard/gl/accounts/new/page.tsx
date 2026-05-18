'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Account, AccountTypeCode } from '@perpet/shared';

const TYPES: AccountTypeCode[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

export default function NewAccountPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    code: '',
    name: '',
    account_type: 'ASSET' as AccountTypeCode,
    parent_id: '',
    currency: 'PHP',
    is_control: false,
    description: '',
  });

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    api.get<Account[]>(`/gl/accounts?company_id=${companyId}&active_only=true`)
      .then(setAccounts).catch(() => {});
  }, []);

  function set(field: string, val: unknown) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  const parentOptions = accounts.filter((a) => a.account_type === form.account_type);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const companyId = localStorage.getItem('company_id')!;
      await api.post('/gl/accounts', {
        company_id: companyId,
        code: form.code,
        name: form.name,
        account_type: form.account_type,
        parent_id: form.parent_id || undefined,
        currency: form.currency,
        is_control: form.is_control,
        description: form.description || undefined,
      });
      router.push('/dashboard/gl/accounts');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create account');
    } finally {
      setSaving(false);
    }
  }

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New GL Account</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Add a new account to the chart of accounts.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Account Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={lbl}>Account Code *</label>
              <input required value={form.code} onChange={(e) => set('code', e.target.value)}
                placeholder="1000" className={inp} />
            </div>
            <div className="col-span-2">
              <label className={lbl}>Account Name *</label>
              <input required value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="Cash on Hand" className={inp} />
            </div>
            <div>
              <label className={lbl}>Account Type *</label>
              <select required value={form.account_type}
                onChange={(e) => { set('account_type', e.target.value); set('parent_id', ''); }}
                className={inp}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Parent Account</label>
              <select value={form.parent_id} onChange={(e) => set('parent_id', e.target.value)} className={inp}>
                <option value="">— none (top-level) —</option>
                {parentOptions.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl}>Currency</label>
              <input value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())}
                maxLength={3} className={inp} />
            </div>
            <div className="col-span-3">
              <label className={lbl}>Description</label>
              <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)}
                className={inp} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_control" checked={form.is_control}
                onChange={(e) => set('is_control', e.target.checked)} />
              <label htmlFor="is_control" className="text-sm text-slate-700 dark:text-slate-300">
                Control account (blocks direct posting)
              </label>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Account'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
