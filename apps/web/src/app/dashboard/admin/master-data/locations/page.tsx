'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Row { id: string; code: string; name: string; address: string | null; phone: string | null; is_active: boolean; }

export default function LocationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', address: '', phone: '' });
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ code: '', name: '', address: '', phone: '', is_active: true });
  const [editSaving, setEditSaving] = useState(false);

  function load() {
    const cid = localStorage.getItem('company_id') ?? '';
    api.get<Row[]>(`/admin/branches?company_id=${cid}`)
      .then(setRows).catch(e => setError(e.message)).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setCreating(true); setError(null);
    try {
      await api.post('/admin/branches', { company_id: cid, ...form });
      setForm({ code: '', name: '', address: '', phone: '' });
      load();
    } catch (e: unknown) { setError((e as Error).message); } finally { setCreating(false); }
  }

  function startEdit(r: Row) {
    setEditId(r.id);
    setEditForm({ code: r.code, name: r.name, address: r.address ?? '', phone: r.phone ?? '', is_active: r.is_active });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); if (!editId) return;
    setEditSaving(true); setError(null);
    try {
      await api.patch(`/admin/branches/${editId}`, editForm);
      setEditId(null); load();
    } catch (e: unknown) { setError((e as Error).message); } finally { setEditSaving(false); }
  }

  const inp = 'rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs dark:bg-slate-800 dark:text-slate-100';

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <Link href="/dashboard/admin/master-data" className="hover:text-brand-600">Master Data</Link>
            <span>/</span>
            <span>Locations</span>
          </div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Locations / Branches</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Farm sites, branches, and office locations.</p>
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={create} className="mb-4 flex flex-wrap gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Code *</label>
          <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required placeholder="e.g. BR-001"
            className="w-28 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Name *</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Location name"
            className="w-56 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Address</label>
          <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Full address"
            className="w-64 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Phone</label>
          <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Contact number"
            className="w-36 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
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
              <th className="px-3 py-2 text-left font-medium">Address</th>
              <th className="px-3 py-2 text-left font-medium">Phone</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-500">No locations. Add one above.</td></tr>
            ) : rows.map(r => (
              editId === r.id ? (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 bg-brand-50 dark:bg-slate-800">
                  <td colSpan={6} className="px-3 py-2">
                    <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
                      <input value={editForm.code} onChange={e => setEditForm(f => ({ ...f, code: e.target.value }))} required placeholder="Code" className={`w-24 ${inp}`} />
                      <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required placeholder="Name" className={`w-48 ${inp}`} />
                      <input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} placeholder="Address" className={`w-56 ${inp}`} />
                      <input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" className={`w-32 ${inp}`} />
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
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.address ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.phone ?? '—'}</td>
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
