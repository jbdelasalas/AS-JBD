'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Permission { id: string; module: string; action: string; description: string | null; }
interface PermGroup { flat: Permission[]; grouped: Record<string, Permission[]>; }

export default function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [all, setAll] = useState<Record<string, Permission[]>>({});
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [roleName, setRoleName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id') ?? '';
    Promise.all([
      api.get<PermGroup>('/admin/permissions'),
      api.get<Permission[]>(`/admin/roles/${id}/permissions`),
      api.get<{ name: string }[]>(`/admin/roles?company_id=${companyId}`),
    ]).then(([allPerms, rolePerms, roles]) => {
      setAll(allPerms.grouped);
      setAssigned(new Set(rolePerms.map((p) => p.id)));
      // Find name from the list
      const matchAll = roles as Array<{ id: string; name: string }>;
      setRoleName(matchAll.find((r) => r.id === id)?.name ?? '');
    }).catch((e) => setError(e.message));
  }, [id]);

  function toggle(pid: string) {
    setAssigned((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }

  function toggleModule(perms: Permission[]) {
    const allIn = perms.every((p) => assigned.has(p.id));
    setAssigned((prev) => {
      const next = new Set(prev);
      for (const p of perms) allIn ? next.delete(p.id) : next.add(p.id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/admin/roles/${id}/permissions`, { permission_ids: [...assigned] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{roleName || 'Role'}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Select permissions for this role.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.back()}
            className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
            Back
          </button>
          <button onClick={save} disabled={saving}
            className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save permissions'}
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="space-y-3">
        {Object.entries(all).map(([module, perms]) => {
          const allIn = perms.every((p) => assigned.has(p.id));
          const someIn = perms.some((p) => assigned.has(p.id));
          return (
            <div key={module} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wide">{module}</h2>
                <button onClick={() => toggleModule(perms)}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${allIn ? 'bg-brand-100 text-brand-700' : someIn ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>
                  {allIn ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {perms.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 rounded p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                    <input type="checkbox" checked={assigned.has(p.id)} onChange={() => toggle(p.id)} />
                    <span className="text-xs text-slate-700 dark:text-slate-300">{p.action}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
