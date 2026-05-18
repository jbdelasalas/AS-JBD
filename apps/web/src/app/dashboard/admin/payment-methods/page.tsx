'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import ImportExportButtons from '@/components/ImportExportButtons';

interface PMRow {
  id: string; code: string; name: string; account_id: string | null;
  requires_reference: boolean; is_active: boolean; account_name: string | null;
}

export default function PaymentMethodsPage() {
  const [rows, setRows] = useState<PMRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', requires_reference: false });
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; requires_reference: boolean; is_active: boolean }>({ name: '', requires_reference: false, is_active: true });
  const [editSaving, setEditSaving] = useState(false);

  function load() {
    const companyId = localStorage.getItem('company_id') ?? '';
    api.get<PMRow[]>(`/admin/payment-methods?company_id=${companyId}`)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setCreating(true);
    setError(null);
    try {
      await api.post('/admin/payment-methods', { company_id: companyId, ...form });
      setForm({ code: '', name: '', requires_reference: false });
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(r: PMRow) {
    setEditId(r.id);
    setEditForm({ name: r.name, requires_reference: r.requires_reference, is_active: r.is_active });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    setError(null);
    try {
      await api.patch(`/admin/payment-methods/${editId}`, editForm);
      setEditId(null);
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  const inp = 'rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs dark:bg-slate-800 dark:text-slate-100';

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Payment Methods</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Configure accepted payment methods and their GL accounts.</p>
        </div>
        <ImportExportButtons
          rows={rows as unknown as Record<string, unknown>[]}
          exportColumns={[
            { key: 'code', header: 'Code' },
            { key: 'name', header: 'Name' },
            { key: 'account_name', header: 'GL Account' },
            { key: 'requires_reference', header: 'Requires Reference' },
            { key: 'is_active', header: 'Active' },
          ]}
          filename="payment-methods"
        />
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={create} className="mb-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Code</label>
          <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} required
            className="w-24 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Name</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required
            className="w-40 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600 dark:text-slate-400">
            <input type="checkbox" checked={form.requires_reference} onChange={(e) => setForm((f) => ({ ...f, requires_reference: e.target.checked }))} />
            Requires reference no.
          </label>
          <button type="submit" disabled={creating}
            className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {creating ? 'Adding…' : '+ Add'}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Code</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">GL Account</th>
              <th className="px-3 py-2 text-left font-medium">Ref required</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.map((r) => (
              editId === r.id ? (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 bg-brand-50 dark:bg-slate-800">
                  <td colSpan={6} className="px-3 py-2">
                    <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">{r.code}</span>
                      <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className={`w-40 ${inp}`} required placeholder="Name" />
                      <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                        <input type="checkbox" checked={editForm.requires_reference} onChange={(e) => setEditForm((f) => ({ ...f, requires_reference: e.target.checked }))} />
                        Req. ref
                      </label>
                      <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                        <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))} />
                        Active
                      </label>
                      <button type="submit" disabled={editSaving}
                        className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" onClick={() => setEditId(null)}
                        className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50">
                        Cancel
                      </button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.code}</td>
                  <td className="px-3 py-2 text-xs text-slate-900 dark:text-slate-100">{r.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.account_name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.requires_reference ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500 dark:text-slate-400'}`}>
                      {r.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => startEdit(r)}
                      className="text-xs text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400">
                      Edit
                    </button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
