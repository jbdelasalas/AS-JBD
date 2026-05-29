'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Row { id: string; code: string; name: string; building_type: string; capacity_heads: number | null; is_active: boolean; }
const TYPES = ['broiler', 'layer', 'breeder', 'nursery', 'isolation'];

export default function BuildingsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', building_type: 'broiler', capacity_heads: '' });
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ code: '', name: '', building_type: 'broiler', capacity_heads: '', is_active: true });
  const [editSaving, setEditSaving] = useState(false);

  function load() {
    const cid = localStorage.getItem('company_id') ?? '';
    api.get<Row[]>(`/poultry/buildings?company_id=${cid}`)
      .then(setRows).catch(e => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setCreating(true); setError(null);
    try {
      await api.post('/poultry/buildings', {
        company_id: cid, code: form.code, name: form.name, building_type: form.building_type,
        capacity_heads: form.capacity_heads ? parseInt(form.capacity_heads) : null,
      });
      setForm({ code: '', name: '', building_type: 'broiler', capacity_heads: '' });
      load();
    } catch (e: unknown) { setError((e as Error).message); } finally { setCreating(false); }
  }

  function startEdit(r: Row) {
    setEditId(r.id);
    setEditForm({ code: r.code, name: r.name, building_type: r.building_type, capacity_heads: r.capacity_heads ? String(r.capacity_heads) : '', is_active: r.is_active });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); if (!editId) return;
    setEditSaving(true); setError(null);
    try {
      await api.patch(`/poultry/buildings/${editId}`, {
        code: editForm.code, name: editForm.name, building_type: editForm.building_type,
        capacity_heads: editForm.capacity_heads ? parseInt(editForm.capacity_heads) : null,
        is_active: editForm.is_active,
      });
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
            <span>/</span><span>Buildings</span>
          </div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Buildings</h1>
          <p className="text-sm text-slate-500">Farm houses and building management.</p>
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={create} className="mb-4 flex flex-wrap gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Code *</label>
          <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required placeholder="e.g. BLD-01"
            className="w-28 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Name *</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Building name"
            className="w-48 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Type</label>
          <select value={form.building_type} onChange={e => setForm(f => ({ ...f, building_type: e.target.value }))}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100">
            {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Capacity (heads)</label>
          <input type="number" min={0} value={form.capacity_heads} onChange={e => setForm(f => ({ ...f, capacity_heads: e.target.value }))} placeholder="0"
            className="w-32 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
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
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Capacity</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-500">No buildings. Add one above.</td></tr>
            ) : rows.map(r => (
              editId === r.id ? (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 bg-brand-50 dark:bg-slate-800">
                  <td colSpan={6} className="px-3 py-2">
                    <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
                      <input value={editForm.code} onChange={e => setEditForm(f => ({ ...f, code: e.target.value }))} required placeholder="Code" className={`w-24 ${inp}`} />
                      <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required placeholder="Name" className={`w-44 ${inp}`} />
                      <select value={editForm.building_type} onChange={e => setEditForm(f => ({ ...f, building_type: e.target.value }))} className={inp}>
                        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input type="number" min={0} value={editForm.capacity_heads} onChange={e => setEditForm(f => ({ ...f, capacity_heads: e.target.value }))} placeholder="Capacity" className={`w-24 ${inp}`} />
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
                  <td className="px-3 py-2 text-xs text-slate-500 capitalize">{r.building_type}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-600 dark:text-slate-400">{r.capacity_heads ? r.capacity_heads.toLocaleString() : '—'}</td>
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
