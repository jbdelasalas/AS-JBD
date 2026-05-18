'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface SeriesRow {
  id: string; doc_type: string; prefix: string; current_number: number;
  branch_id: string | null; updated_at: string;
}

export default function DocumentSeriesPage() {
  const [rows, setRows] = useState<SeriesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ prefix: '', current_number: 0 });
  const [saving, setSaving] = useState(false);

  function load() {
    const companyId = localStorage.getItem('company_id') ?? '';
    api.get<SeriesRow[]>(`/admin/document-series?company_id=${companyId}`)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function startEdit(r: SeriesRow) {
    setEditing(r.id);
    setEditForm({ prefix: r.prefix, current_number: r.current_number });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/admin/document-series/${id}`, editForm);
      setEditing(null);
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Document Series</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Configure number prefixes and reset sequences.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Doc type</th>
              <th className="px-3 py-2 text-left font-medium">Prefix</th>
              <th className="px-3 py-2 text-right font-medium">Last no.</th>
              <th className="px-3 py-2 text-left font-medium">Next number</th>
              <th className="px-3 py-2 text-left font-medium">Updated</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 font-mono text-xs font-medium text-slate-700 dark:text-slate-300">{r.doc_type}</td>
                {editing === r.id ? (
                  <>
                    <td className="px-3 py-1">
                      <input value={editForm.prefix} onChange={(e) => setEditForm((f) => ({ ...f, prefix: e.target.value }))}
                        className="w-24 rounded border border-slate-300 dark:border-slate-600 px-1.5 py-1 text-xs dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-3 py-1">
                      <input type="number" value={editForm.current_number} onChange={(e) => setEditForm((f) => ({ ...f, current_number: Number(e.target.value) }))}
                        className="w-20 rounded border border-slate-300 dark:border-slate-600 px-1.5 py-1 text-xs text-right dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {editForm.prefix}{new Date().getFullYear()}-{String(editForm.current_number + 1).padStart(6, '0')}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400" />
                    <td className="px-3 py-2 flex gap-1">
                      <button onClick={() => saveEdit(r.id)} disabled={saving}
                        className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                        Save
                      </button>
                      <button onClick={() => setEditing(null)}
                        className="rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs text-slate-600 dark:text-slate-400">
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.prefix}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-600 dark:text-slate-400">{r.current_number.toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {r.prefix}{new Date().getFullYear()}-{String(r.current_number + 1).padStart(6, '0')}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{formatDate(r.updated_at)}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => startEdit(r)}
                        className="rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
                        Edit
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
