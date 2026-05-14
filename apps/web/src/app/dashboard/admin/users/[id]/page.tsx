'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface UserDetail {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superadmin: boolean;
  twofa_enabled: boolean;
  created_at: string;
  roles: Array<{ company_id: string | null; role_id: string; role_name: string }>;
}

interface Role { id: string; name: string; }

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [form, setForm] = useState({ full_name: '', is_active: true, is_superadmin: false, password: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id') ?? '';
    Promise.all([
      api.get<UserDetail>(`/admin/users/${id}`),
      api.get<Role[]>(`/admin/roles?company_id=${companyId}`),
    ]).then(([u, roles]) => {
      setUser(u);
      setAllRoles(roles);
      setForm({ full_name: u.full_name, is_active: u.is_active, is_superadmin: u.is_superadmin, password: '' });
    }).catch((e) => setError(e.message));
  }, [id]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        full_name: form.full_name,
        is_active: form.is_active,
        is_superadmin: form.is_superadmin,
      };
      if (form.password) payload.password = form.password;
      await api.patch(`/admin/users/${id}`, payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{error ?? 'Loading…'}</div>;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{user.full_name}</h1>
        <button onClick={() => router.back()}
          className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
          Back
        </button>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Full name</label>
            <input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Email</label>
            <input value={user.email} disabled
              className="w-full rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-500 dark:text-slate-400" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">New password (leave blank to keep)</label>
          <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder="••••••••"
            className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
            Active
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.is_superadmin} onChange={(e) => setForm((f) => ({ ...f, is_superadmin: e.target.checked }))} />
            Superadmin
          </label>
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Assigned roles */}
      <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Assigned roles</h2>
        {user.roles.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No roles assigned.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.roles.map((r) => (
              <span key={r.role_id} className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-300">
                {r.role_name}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Manage role assignments via the Roles page.
        </p>
      </div>
    </div>
  );
}
