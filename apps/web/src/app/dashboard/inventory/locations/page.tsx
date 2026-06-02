'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import DataTable, { ColDef } from '@/components/DataTable';

interface Location {
  id: string;
  code: string;
  name: string;
  address: string | null;
  is_active: boolean;
  item_count: number;
}

const blank = (): Partial<Location> => ({ code: '', name: '', address: '', is_active: true });

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Location>>(blank());

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') ?? '' : '';

  const load = useCallback(() => {
    setLoading(true);
    api.get<Location[]>(`/inventory/locations?company_id=${companyId}`)
      .then(setLocations)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function startAdd() {
    setEditId(null);
    setForm(blank());
    setFormMsg(null);
    setShowForm(true);
  }

  function startEdit(loc: Location) {
    setForm({ code: loc.code, name: loc.name, address: loc.address ?? '', is_active: loc.is_active });
    setEditId(loc.id);
    setFormMsg(null);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditId(null);
    setFormMsg(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormMsg(null);
    try {
      if (editId) {
        await api.patch(`/inventory/locations/${editId}`, {
          code: form.code, name: form.name,
          address: form.address || null,
          is_active: form.is_active,
        });
      } else {
        await api.post(`/inventory/locations`, {
          company_id: companyId,
          code: form.code, name: form.name,
          address: form.address || null,
          is_active: form.is_active ?? true,
        });
      }
      cancelForm();
      load();
    } catch (e: unknown) {
      setFormMsg((e as Error).message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

  const COLUMNS: ColDef<Location>[] = [
    { key: 'code',      header: 'Code',    render: r => <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">{r.code}</span>, exportValue: r => r.code },
    { key: 'name',      header: 'Name',    render: r => <span className="font-medium text-slate-900 dark:text-slate-100">{r.name}</span>, exportValue: r => r.name },
    { key: 'address',   header: 'Address', render: r => <span className="text-xs text-slate-500 dark:text-slate-400">{r.address ?? '—'}</span>, exportValue: r => r.address ?? '' },
    { key: 'item_count',header: 'Items',   align: 'right', render: r => <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{r.item_count}</span>, exportValue: r => String(r.item_count) },
    { key: 'is_active', header: 'Status',  render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{r.is_active ? 'active' : 'inactive'}</span>, exportValue: r => r.is_active ? 'active' : 'inactive' },
    { key: 'actions',   header: '',        render: r => <button onClick={() => startEdit(r)} className="text-xs text-brand-700 hover:underline dark:text-brand-400">Edit</button>, exportValue: () => '' },
  ];

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Locations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Warehouses and storage locations for inventory tracking.</p>
        </div>
        {!showForm && (
          <button onClick={startAdd}
            className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">
            + Add Location
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {showForm && (
        <form onSubmit={submit} className="rounded-lg border border-brand-200 dark:border-brand-800 bg-white dark:bg-slate-900 p-5 mb-5">
          <div className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
            {editId ? 'Edit Location' : 'New Location'}
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className={lbl}>Code *</label>
              <input required value={form.code ?? ''} maxLength={20}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="WH-MAIN" className={inp} />
            </div>
            <div className="col-span-2">
              <label className={lbl}>Name *</label>
              <input required value={form.name ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Main Warehouse" className={inp} />
            </div>
            <div>
              <label className={lbl}>Active</label>
              <select value={form.is_active ? 'true' : 'false'}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'true' }))}
                className={inp}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div className="col-span-4">
              <label className={lbl}>Address</label>
              <input value={form.address ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Street, City" className={inp} />
            </div>
          </div>
          {formMsg && <p className="mt-2 text-xs text-red-600">{formMsg}</p>}
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={saving}
              className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Location'}
            </button>
            <button type="button" onClick={cancelForm}
              className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </form>
      )}

      <DataTable id="inventory-locations" columns={COLUMNS} rows={locations} loading={loading} filename="locations"
        emptyMessage='No locations yet. Click "+ Add Location" to create one.' />
    </div>
  );
}
