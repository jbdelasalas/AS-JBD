'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface FlagRow {
  id: string; name: string; enabled: boolean;
  description: string | null; updated_at: string;
}

export default function FeatureFlagsPage() {
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  function load() {
    api.get<FlagRow[]>('/admin/feature-flags')
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function toggle(id: string, current: boolean) {
    setToggling(id);
    setError(null);
    try {
      await api.patch(`/admin/feature-flags/${id}`, { enabled: !current });
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, enabled: !current } : r));
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setToggling(null);
    }
  }

  async function createFlag(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.post('/admin/feature-flags', { name: newName.trim() });
      setNewName('');
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Feature Flags</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Toggle features on or off system-wide.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={createFlag} className="mb-4 flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New flag name…"
          className="flex-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        <button type="submit" disabled={creating}
          className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {creating ? 'Creating…' : '+ Create flag'}
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Flag name</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">No feature flags.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.name}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.description ?? '—'}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => toggle(r.id, r.enabled)}
                    disabled={toggling === r.id}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'} disabled:opacity-50`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${r.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                  <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">{r.enabled ? 'On' : 'Off'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
