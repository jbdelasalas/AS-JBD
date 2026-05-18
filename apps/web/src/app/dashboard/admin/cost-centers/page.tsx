'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import ImportExportButtons from '@/components/ImportExportButtons';

interface CCRow { id: string; code: string; name: string; parent_id: string | null; is_active: boolean; parent_name: string | null; }

export default function CostCentersPage() {
  const [rows, setRows] = useState<CCRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', parent_id: '' });
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ code: string; name: string; parent_id: string; is_active: boolean }>({ code: '', name: '', parent_id: '', is_active: true });
  const [editSaving, setEditSaving] = useState(false);

  function load() {
    const companyId = localStorage.getItem('company_id') ?? '';
    api.get<CCRow[]>(`/admin/cost-centers?company_id=${companyId}`)
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
      await api.post('/admin/cost-centers', {
        company_id: companyId, code: form.code, name: form.name,
        parent_id: form.parent_id || null,
      });
      setForm({ code: '', name: '', parent_id: '' });
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(r: CCRow) {
    setEditId(r.id);
    setEditForm({ code: r.code, name: r.name, parent_id: r.parent_id ?? '', is_active: r.is_active });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    setError(null);
    try {
      await api.patch(`/admin/cost-centers/${editId}`, {
        code: editForm.code,
        name: editForm.name,
        parent_id: editForm.parent_id || null,
        is_active: editForm.is_active,
      });
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
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Cost Centers</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Departments and cost allocation centers.</p>
        </div>
        <ImportExportButtons
          rows={rows as unknown as Record<string, unknown>[]}
          exportColumns={[
            { key: 'code', header: 'Code' },
            { key: 'name', header: 'Name' },
            { key: 'parent_name', header: 'Parent' },
            { key: 'is_active', header: 'Active' },
          ]}
          filename="cost-centers"
        />
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={create} className="mb-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Code</label>
          <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required
            className="w-24 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Name</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required
            className="w-48 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Parent (optional)</label>
          <select value={form.parent_id} onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100">
            <option value="">— none —</option>
            {rows.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
          </select>
        </div>
        <div className="flex items-end">
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
              <th className="px-3 py-2 text-left font-medium">Parent</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">No cost centers. Add one above.</td></tr>
            ) : rows.map((r) => (
              editId === r.id ? (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 bg-brand-50 dark:bg-slate-800">
                  <td colSpan={5} className="px-3 py-2">
                    <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
                      <input value={editForm.code} onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value }))}
                        className={`w-24 ${inp}`} required placeholder="Code" />
                      <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className={`w-48 ${inp}`} required placeholder="Name" />
                      <select value={editForm.parent_id} onChange={(e) => setEditForm((f) => ({ ...f, parent_id: e.target.value }))}
                        className={inp}>
                        <option value="">— no parent —</option>
                        {rows.filter((x) => x.id !== r.id).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
                      </select>
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
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.parent_name ?? '—'}</td>
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
