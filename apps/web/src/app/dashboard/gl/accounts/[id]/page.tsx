'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { Account, AccountTypeCode } from '@perpet/shared';

interface LedgerEntry {
  id: string;
  entry_id: string;
  entry_no: string;
  entry_date: string;
  description: string | null;
  memo: string | null;
  source_module: string;
  source_doc_type: string | null;
  source_doc_id: string | null;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  debit: number;
  credit: number;
  balance: number;
}

const TYPES: AccountTypeCode[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Account>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<Account>(`/gl/accounts/${id}`),
      api.get<LedgerEntry[]>(`/gl/accounts/${id}/ledger`),
    ]).then(([a, entries]) => { setAccount(a); setForm(a); setLedger(entries); })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    api.get<Account[]>(`/gl/accounts?company_id=${companyId}&active_only=true`).then(setAccounts).catch(() => {});
  }, []);

  function set(field: string, val: unknown) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  const parentOptions = accounts.filter((a) => a.account_type === form.account_type && a.id !== id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/gl/accounts/${id}`, {
        name: form.name,
        account_type: form.account_type,
        parent_id: form.parent_id || null,
        currency: form.currency,
        is_control: form.is_control,
        description: form.description || null,
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

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!account) return <div className="py-10 text-center text-sm text-red-600">Account not found</div>;

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';
  const showCustomerCol = ledger.some((e) => e.customer_id);

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <Link href="/dashboard/gl/accounts" className="text-xs text-slate-500 hover:underline">← Chart of Accounts</Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{account.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{account.code} · {account.account_type}</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Edit
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {editing ? (
        <form onSubmit={save} className="space-y-5">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
            <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Account Details</div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={lbl}>Account Code</label>
                <input value={account.code} disabled className={`${inp} bg-slate-50 text-slate-400`} />
              </div>
              <div className="col-span-2">
                <label className={lbl}>Account Name *</label>
                <input required value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Account Type *</label>
                <select required value={form.account_type ?? 'ASSET'}
                  onChange={(e) => { set('account_type', e.target.value); set('parent_id', null); }}
                  className={inp}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Parent Account</label>
                <select value={form.parent_id ?? ''} onChange={(e) => set('parent_id', e.target.value || null)} className={inp}>
                  <option value="">— none (top-level) —</option>
                  {parentOptions.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Currency</label>
                <input value={form.currency ?? 'PHP'} onChange={(e) => set('currency', e.target.value.toUpperCase())}
                  maxLength={3} className={inp} />
              </div>
              <div className="col-span-3">
                <label className={lbl}>Description</label>
                <textarea rows={2} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} className={inp} />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={form.is_control ?? false} onChange={(e) => set('is_control', e.target.checked)} />
                  Control account
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={form.is_active ?? true} onChange={(e) => set('is_active', e.target.checked)} />
                  Active
                </label>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving}
              className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setForm(account); setError(null); }}
              className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {[
                ['Code', account.code],
                ['Name', account.name],
                ['Type', account.account_type],
                ['Currency', account.currency],
                ['Control', account.is_control ? 'Yes' : 'No'],
                ['Status', account.is_active ? 'Active' : 'Inactive'],
                ['Description', account.description ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-28 shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Ledger */}
          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              Ledger (last 50 posted entries)
            </div>
            {ledger.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-400">No posted transactions found.</div>
            ) : (
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Entry No.</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Description</th>
                    {showCustomerCol && <th className="px-3 py-2 text-left font-medium">Customer</th>}
                    <th className="px-3 py-2 text-left font-medium">Module</th>
                    <th className="px-3 py-2 text-right font-medium">Debit</th>
                    <th className="px-3 py-2 text-right font-medium">Credit</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">{e.entry_no}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatDate(e.entry_date)}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{e.description ?? e.memo ?? '—'}</td>
                      {showCustomerCol && (
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                          {e.customer_id ? (
                            <Link href={`/dashboard/ar/customers/${e.customer_id}`} className="text-brand-600 hover:underline">
                              {e.customer_name ?? e.customer_code}
                            </Link>
                          ) : '—'}
                        </td>
                      )}
                      <td className="px-3 py-2 capitalize text-slate-500 dark:text-slate-400">{e.source_module.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">{e.debit > 0 ? formatPHP(e.debit) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">{e.credit > 0 ? formatPHP(e.credit) : '—'}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${e.balance < 0 ? 'text-red-600' : 'text-slate-900 dark:text-slate-100'}`}>
                        {formatPHP(Math.abs(e.balance))}{e.balance < 0 ? ' Cr' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
