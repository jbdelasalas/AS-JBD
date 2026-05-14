'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permission_count: number;
}

export default function RolesPage() {
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    const companyId = localStorage.getItem('company_id') ?? '';
    api.get<RoleRow[]>(`/admin/roles?company_id=${companyId}`)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const companyId = localStorage.getItem('company_id');
    try {
      await api.post('/admin/roles', { company_id: companyId, name: newName.trim() });
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
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Roles & Permissions</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Define roles and control what each role can do.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={createRole} className="mb-4 flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New role name…"
          className="flex-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        <button type="submit" disabled={creating}
          className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {creating ? 'Creating…' : '+ Create role'}
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Permissions</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">No roles defined.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/admin/roles/${r.id}`} className="font-medium text-brand-700 dark:text-brand-400 hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.description ?? '—'}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-400">{r.permission_count}</td>
                <td className="px-3 py-2">
                  {r.is_system ? (
                    <span className="rounded bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700">system</span>
                  ) : (
                    <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-400">custom</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
