'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface GlAccount { id: string; code: string; name: string; }
interface BankAccount {
  id: string; account_name: string; bank_name: string | null;
  account_number: string | null; gl_account_id: string | null;
  gl_code: string | null; gl_name: string | null; is_active: boolean;
}

const EMPTY = { account_name: '', bank_name: '', account_number: '', gl_account_id: '' };

export default function BankAccountsPage() {
  const [rows, setRows] = useState<BankAccount[]>([]);
  const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function getCompanyId() { return localStorage.getItem('company_id') ?? ''; }

  async function load() {
    setLoading(true);
    const cid = getCompanyId();
    try {
      const [b, g] = await Promise.all([
        api.get<{ data: BankAccount[] }>(`/bank-accounts?company_id=${cid}`),
        api.get<{ data: GlAccount[] }>(`/gl/accounts?company_id=${cid}&limit=500`),
      ]);
      setRows(b.data);
      setGlAccounts((g.data as GlAccount[]).filter((a) => (a as unknown as { account_type: string }).account_type === 'ASSET'));
    } catch { setRows([]); } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openNew() { setEditing(null); setForm(EMPTY); setError(''); setShowForm(true); }
  function openEdit(r: BankAccount) {
    setEditing(r);
    setForm({ account_name: r.account_name, bank_name: r.bank_name ?? '', account_number: r.account_number ?? '', gl_account_id: r.gl_account_id ?? '' });
    setError(''); setShowForm(true);
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const cid = getCompanyId();
      const body = { ...form, bank_name: form.bank_name || undefined, account_number: form.account_number || undefined, gl_account_id: form.gl_account_id || undefined };
      if (editing) {
        await api.patch(`/bank-accounts/${editing.id}`, body);
      } else {
        await api.post('/bank-accounts', { ...body, company_id: cid });
      }
      setShowForm(false); load();
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed'); }
    finally { setSaving(false); }
  }

  async function deactivate(id: string) {
    if (!confirm('Deactivate this bank account?')) return;
    await api.delete(`/bank-accounts/${id}`).catch(() => {});
    load();
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Bank Accounts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage bank and cash accounts linked to the Chart of Accounts</p>
        </div>
        <button onClick={openNew}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + Add Bank Account
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              {['Account Name', 'Bank', 'Account Number', 'GL Account', 'Status', ''].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No bank accounts. Click "+ Add Bank Account" to create one.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{r.account_name}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{r.bank_name ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{r.account_number ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                  {r.gl_code ? <span className="font-mono text-xs">{r.gl_code}</span> : '—'}
                  {r.gl_name ? <span className="ml-1 text-xs text-slate-500"> {r.gl_name}</span> : ''}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {r.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openEdit(r)} className="mr-2 text-xs text-blue-600 hover:underline">Edit</button>
                  {r.is_active && <button onClick={() => deactivate(r.id)} className="text-xs text-red-600 hover:underline">Deactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-slate-900 shadow-xl p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
              {editing ? 'Edit Bank Account' : 'New Bank Account'}
            </h2>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Account Name *</label>
                <input value={form.account_name} onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                  placeholder="e.g. BDO - Main Operating Account" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Bank Name</label>
                  <input value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    placeholder="e.g. BDO Unibank" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Account Number</label>
                  <input value={form.account_number} onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    placeholder="e.g. 0762-XXXX-XX" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Linked GL Account (COA)</label>
                <select value={form.gl_account_id} onChange={(e) => setForm((f) => ({ ...f, gl_account_id: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
                  <option value="">— select GL account —</option>
                  {glAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300">
                Cancel
              </button>
              <button onClick={save} disabled={saving || !form.account_name}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
