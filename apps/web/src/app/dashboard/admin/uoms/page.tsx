'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import ImportExportButtons from '@/components/ImportExportButtons';

interface UomRow { id: string; code: string; name: string; type: string; is_base: boolean; }

const UOM_TYPES = ['COUNT', 'WEIGHT', 'VOLUME', 'LENGTH', 'TIME'];

export default function UomsPage() {
  const [rows, setRows] = useState<UomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', type: 'COUNT', is_base: false });
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<UomRow>>({});
  const [editSaving, setEditSaving] = useState(false);

  function load() {
    const companyId = localStorage.getItem('company_id') ?? '';
    api.get<UomRow[]>(`/admin/uoms?company_id=${companyId}`)
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
      await api.post('/admin/uoms', { company_id: companyId, ...form });
      setForm({ code: '', name: '', type: 'COUNT', is_base: false });
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(u: UomRow) {
    setEditId(u.id);
    setEditForm({ code: u.code, name: u.name, type: u.type, is_base: u.is_base });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    setError(null);
    try {
      await api.patch(`/admin/uoms/${editId}`, editForm);
      setEditId(null);
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  const grouped = UOM_TYPES.map((t) => ({ type: t, items: rows.filter((r) => r.type === t) })).filter((g) => g.items.length > 0);
  const inp = 'rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs dark:bg-slate-800 dark:text-slate-100';

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Units of Measure</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Define measurement units used for inventory and items.</p>
        </div>
        <ImportExportButtons
          rows={rows as unknown as Record<string, unknown>[]}
          exportColumns={[
            { key: 'code', header: 'Code' },
            { key: 'name', header: 'Name' },
            { key: 'type', header: 'Type' },
            { key: 'is_base', header: 'Is Base' },
          ]}
          filename="uoms"
        />
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={create} className="mb-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Code</label>
          <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} required
            className="w-20 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Name</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required
            className="w-32 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Type</label>
          <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100">
            {UOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600 dark:text-slate-400">
            <input type="checkbox" checked={form.is_base} onChange={(e) => setForm((f) => ({ ...f, is_base: e.target.checked }))} />
            Base unit
          </label>
          <button type="submit" disabled={creating}
            className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {creating ? 'Adding…' : '+ Add UoM'}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="text-center text-xs text-slate-500 dark:text-slate-400 py-6">Loading…</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ type, items }) => (
            <div key={type} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                {type}
              </div>
              <table className="min-w-full text-sm">
                <tbody>
                  {items.map((u) => (
                    editId === u.id ? (
                      <tr key={u.id} className="border-b border-slate-100 dark:border-slate-700 bg-brand-50 dark:bg-slate-800">
                        <td colSpan={4} className="px-3 py-2">
                          <form onSubmit={saveEdit} className="flex items-center gap-2">
                            <input value={editForm.code ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                              className={`w-20 ${inp}`} required />
                            <input value={editForm.name ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                              className={`w-36 ${inp}`} required />
                            <select value={editForm.type ?? 'COUNT'} onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}
                              className={inp}>
                              {UOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                              <input type="checkbox" checked={editForm.is_base ?? false} onChange={(e) => setEditForm((f) => ({ ...f, is_base: e.target.checked }))} />
                              Base
                            </label>
                            <button type="submit" disabled={editSaving}
                              className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                              {editSaving ? 'Saving…' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setEditId(null)}
                              className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
                              Cancel
                            </button>
                          </form>
                        </td>
                      </tr>
                    ) : (
                      <tr key={u.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="px-3 py-2 font-mono text-xs font-medium text-slate-700 dark:text-slate-300 w-20">{u.code}</td>
                        <td className="px-3 py-2 text-xs text-slate-900 dark:text-slate-100">{u.name}</td>
                        <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                          {u.is_base && <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">base</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => startEdit(u)}
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
          ))}
        </div>
      )}
    </div>
  );
}
