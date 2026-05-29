'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Row { id: string; code: string; name: string; description: string | null; is_active: boolean; }

export default function DepartmentsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ code: '', name: '', description: '', is_active: true });
  const [editSaving, setEditSaving] = useState(false);

  function load() {
    const cid = localStorage.getItem('company_id') ?? '';
    api.get<Row[]>(`/admin/departments?company_id=${cid}`)
      .then(setRows).catch(e => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setCreating(true); setError(null);
    try {
      await api.post('/admin/departments', { company_id: cid, ...form, description: form.description || null });
      setForm({ code: '', name: '', description: '' });
      load();
    } catch (e: unknown) { setError((e as Error).message); } finally { setCreating(false); }
  }

  function startEdit(r: Row) {
    setEditId(r.id);
    setEditForm({ code: r.code, name: r.name, description: r.description ?? '', is_active: r.is_active });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); if (!editId) return;
    setEditSaving(true); setError(null);
    try {
      await api.patch(`/admin/departments/${editId}`, { ...editForm, description: editForm.description || null });
      setEditId(null); load();
    } catch (e: unknown) { setError((e as Error).message); } finally { setEditSaving(false); }
  }

  const inp = 'rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs dark:bg-slate-800 dark:text-slate-100';

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
          <Link href="/dashboard/admin/master-data" className="hover:text-brand-600">Master Data</Link>
          <span>/</span><span>Departments</span>
        </div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Departments</h1>
        <p className="text-sm text-slate-500">Company departments and business units.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={create} className="mb-4 flex flex-wrap gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Code *</label>
          <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required placeholder="e.g. DEPT-01"
            className="w-28 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Name *</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Department name"
            className="w-52 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Description</label>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional"
            className="w-64 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
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
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-slate-500">No departments. Add one above.</td></tr>
            ) : rows.map(r => (
              editId === r.id ? (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 bg-brand-50 dark:bg-slate-800">
                  <td colSpan={5} className="px-3 py-2">
                    <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
                      <input value={editForm.code} onChange={e => setEditForm(f => ({ ...f, code: e.target.value }))} required placeholder="Code" className={`w-24 ${inp}`} />
                      <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required placeholder="Name" className={`w-48 ${inp}`} />
                      <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" className={`w-56 ${inp}`} />
                      <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                        <input type="checkbox" checked={editForm.is_active} onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))} /> Active
                      </label>
                      <button type="submit" disabled={editSaving} className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{editSaving ? 'Saving…' : 'Save'}</button>
                      <button type="button" onClick={() => setEditId(null)} className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.code}</td>
                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{r.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.description ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {r.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => startEdit(r)} className="text-xs text-slate-500 hover:text-brand-600 dark:text-slate-400">Edit</button>
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
