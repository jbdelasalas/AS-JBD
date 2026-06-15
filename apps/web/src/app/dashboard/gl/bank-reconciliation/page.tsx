'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';

interface BankAccount { id: string; account_name: string; bank_name: string | null; gl_account_id: string | null; }
interface Reconciliation {
  id: string; bank_account_id: string; account_name: string; bank_name: string | null;
  statement_date: string; statement_ending_balance: number; beginning_balance: number;
  status: string; cleared_balance: number | null; difference: number | null;
}

const EMPTY = { bank_account_id: '', statement_date: '', statement_ending_balance: '' };

export default function BankReconciliationPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Reconciliation[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function getCompanyId() { return localStorage.getItem('company_id') ?? ''; }

  async function load() {
    setLoading(true);
    const cid = getCompanyId();
    try {
      const [r, b] = await Promise.all([
        api.get<{ data: Reconciliation[] }>(`/gl/bank-reconciliations?company_id=${cid}`),
        api.get<{ data: BankAccount[] }>(`/bank-accounts?company_id=${cid}`),
      ]);
      setRows(r.data);
      setBanks(b.data.filter((x) => x.gl_account_id));
    } catch { setRows([]); } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setForm({ ...EMPTY, statement_date: new Date().toISOString().split('T')[0] });
    setError(''); setShowForm(true);
  }

  async function start() {
    setSaving(true); setError('');
    try {
      const cid = getCompanyId();
      const res = await api.post<{ id: string }>('/gl/bank-reconciliations', {
        company_id: cid,
        bank_account_id: form.bank_account_id,
        statement_date: form.statement_date,
        statement_ending_balance: Number(form.statement_ending_balance || 0),
      });
      setShowForm(false);
      router.push(`/dashboard/gl/bank-reconciliation/${res.id}`);
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed to start reconciliation'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Bank Reconciliation</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Match your books against bank statements and prove the balance</p>
        </div>
        <button onClick={openNew}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + Start Reconciliation
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              {['Bank Account', 'Statement Date', 'Statement Balance', 'Difference', 'Status', ''].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No reconciliations yet. Click "+ Start Reconciliation" to begin.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}
                onClick={() => router.push(`/dashboard/gl/bank-reconciliation/${r.id}`)}
                className="cursor-pointer border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                  {r.account_name}{r.bank_name ? <span className="ml-1 text-xs text-slate-500">· {r.bank_name}</span> : ''}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{r.statement_date}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-900 dark:text-slate-100">{formatPHP(r.statement_ending_balance)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {r.difference === null
                    ? <span className="text-slate-400">—</span>
                    : <span className={Math.abs(r.difference) < 0.005 ? 'text-green-600' : 'text-red-600'}>{formatPHP(r.difference)}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {r.status === 'completed' ? 'Completed' : 'In Progress'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="text-xs text-blue-600 hover:underline">Open →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-slate-900 shadow-xl p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">Start Reconciliation</h2>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            {banks.length === 0 && (
              <p className="mb-3 text-sm text-amber-600">No bank accounts linked to a GL account. Set one up in Settings → Bank Accounts first.</p>
            )}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Bank Account *</label>
                <select value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
                  <option value="">— select bank account —</option>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.account_name}{b.bank_name ? ` · ${b.bank_name}` : ''}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Statement Date *</label>
                  <input type="date" value={form.statement_date} onChange={(e) => setForm((f) => ({ ...f, statement_date: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Statement Ending Balance *</label>
                  <input type="number" step="0.01" value={form.statement_ending_balance} onChange={(e) => setForm((f) => ({ ...f, statement_ending_balance: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm font-mono"
                    placeholder="0.00" />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300">
                Cancel
              </button>
              <button onClick={start} disabled={saving || !form.bank_account_id || !form.statement_date}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Starting…' : 'Start'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
