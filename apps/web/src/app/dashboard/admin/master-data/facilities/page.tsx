'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

// Facility / brand names printed on dressed-chicken traceability labels.
// Managed here rather than typed per station, so one plant cannot end up on
// stock under three different spellings.

interface Row {
  id: string;
  name: string;
  address: string | null;
  is_default: boolean;
  is_active: boolean;
}

const NAME_MAX = 60; // what fits on a label

export default function FacilitiesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', address: '', is_default: false });
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', address: '', is_default: false, is_active: true });
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(() => {
    const cid = localStorage.getItem('company_id') ?? '';
    if (!cid) { setLoading(false); setError('No company selected — sign in again.'); return; }
    api
      .get<{ data: Row[] }>(`/dressing-plant/facilities?company_id=${cid}&include_inactive=true`)
      .then((r) => setRows(r.data ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    setCreating(true);
    setError(null);
    try {
      await api.post('/dressing-plant/facilities', {
        company_id: cid,
        name: form.name,
        address: form.address || null,
        is_default: form.is_default,
      });
      setForm({ name: '', address: '', is_default: false });
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(r: Row) {
    setEditId(r.id);
    setEditForm({
      name: r.name,
      address: r.address ?? '',
      is_default: r.is_default,
      is_active: r.is_active,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    setError(null);
    try {
      await api.patch(`/dressing-plant/facilities/${editId}`, {
        name: editForm.name,
        address: editForm.address || null,
        is_default: editForm.is_default,
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
      <div className="mb-4">
        <div className="mb-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Link href="/dashboard/admin/master-data" className="hover:text-brand-600">Master Data</Link>
          <span>/</span><span>Facilities</span>
        </div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Facilities</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Brand / facility names printed on product labels and encoded in their QR codes. The
          default is pre-selected on{' '}
          <Link href="/dashboard/dressing-plant/labels" className="text-brand-700 hover:underline dark:text-brand-400">
            Dressing Plant → Product Labels
          </Link>.
        </p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={create} className="mb-4 flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div>
          <label htmlFor="fac-name" className="mb-1 block text-xs text-slate-600 dark:text-slate-400">
            Facility name * <span className="text-slate-400">(max {NAME_MAX})</span>
          </label>
          <input
            id="fac-name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            maxLength={NAME_MAX}
            placeholder="e.g. AFCC Dressing Plant"
            className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div>
          <label htmlFor="fac-addr" className="mb-1 block text-xs text-slate-600 dark:text-slate-400">
            Address <span className="text-slate-400">(not printed)</span>
          </label>
          <input
            id="fac-addr"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            maxLength={200}
            placeholder="Optional"
            className="w-72 rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
            />
            Default
          </label>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {creating ? 'Adding…' : '+ Add'}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Facility name</th>
              <th className="px-3 py-2 text-left font-medium">Address</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-slate-500">No facilities yet. Add one above.</td></tr>
            ) : rows.map((r) => (
              editId === r.id ? (
                <tr key={r.id} className="border-b border-slate-100 bg-brand-50 dark:border-slate-700 dark:bg-slate-800">
                  <td colSpan={4} className="px-3 py-2">
                    <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        required
                        maxLength={NAME_MAX}
                        placeholder="Facility name"
                        className={`w-56 ${inp}`}
                      />
                      <input
                        value={editForm.address}
                        onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                        maxLength={200}
                        placeholder="Address"
                        className={`w-64 ${inp}`}
                      />
                      <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                        <input
                          type="checkbox"
                          checked={editForm.is_default}
                          onChange={(e) => setEditForm((f) => ({ ...f, is_default: e.target.checked }))}
                        /> Default
                      </label>
                      <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                        <input
                          type="checkbox"
                          checked={editForm.is_active}
                          onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
                        /> Active
                      </label>
                      <button type="submit" disabled={editSaving} className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" onClick={() => setEditId(null)} className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                        Cancel
                      </button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                    {r.name}
                    {r.is_default && (
                      <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">default</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.address ?? '—'}</td>
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

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Facilities are deactivated, never deleted — issued lot numbers reference the plant that
        printed them, and a traceability record has to keep pointing at it.
      </p>
    </div>
  );
}
