'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface UserOption { id: string; full_name: string; email: string; }
interface DeptOption { id: string; name: string; }

export default function NewEmployeePage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [form, setForm] = useState({
    employee_no: '',
    full_name: '',
    email: '',
    phone: '',
    position: '',
    employment_type: 'full_time',
    hire_date: '',
    end_date: '',
    department_id: '',
    user_id: '',
    is_active: true,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id') ?? '';
    Promise.all([
      api.get<UserOption[]>(`/admin/users?company_id=${companyId}`),
      api.get<DeptOption[]>(`/admin/departments?company_id=${companyId}`),
    ]).then(([u, d]) => { setUsers(u); setDepartments(d); }).catch(() => {});
  }, []);

  function pickUser(userId: string) {
    const u = users.find((x) => x.id === userId);
    setForm((f) => ({
      ...f,
      user_id: userId,
      full_name: f.full_name || u?.full_name || '',
      email: f.email || u?.email || '',
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const companyId = localStorage.getItem('company_id') ?? '';
    try {
      const payload = {
        ...form,
        company_id: companyId,
        department_id: form.department_id || null,
        user_id: form.user_id || null,
        hire_date: form.hire_date || null,
        end_date: form.end_date || null,
        email: form.email || null,
        phone: form.phone || null,
        notes: form.notes || null,
      };
      const res = await api.post<{ id: string }>('/admin/employees', payload);
      router.push(`/dashboard/admin/employees/${res.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed');
      setSaving(false);
    }
  }

  const field = 'w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100';
  const label = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">New Employee</h1>
        <button type="button" onClick={() => router.back()}
          className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
          Back
        </button>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={submit} className="space-y-5">
        {/* Link to system user */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">System User Account</h2>
          <div>
            <label className={label}>Link to existing user (optional)</label>
            <select value={form.user_id} onChange={(e) => pickUser(e.target.value)} className={field}>
              <option value="">— No user account —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">Selecting a user auto-fills name and email below.</p>
          </div>
        </div>

        {/* Basic info */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Basic Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Employee No *</label>
              <input required value={form.employee_no} onChange={(e) => setForm((f) => ({ ...f, employee_no: e.target.value }))} className={field} placeholder="EMP-001" />
            </div>
            <div>
              <label className={label}>Full Name *</label>
              <input required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} className={field} />
            </div>
            <div>
              <label className={label}>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={field} />
            </div>
            <div>
              <label className={label}>Phone</label>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={field} />
            </div>
          </div>
        </div>

        {/* Employment details */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Employment Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Department</label>
              <select value={form.department_id} onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))} className={field}>
                <option value="">— None —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Position / Job Title</label>
              <input value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} className={field} />
            </div>
            <div>
              <label className={label}>Employment Type</label>
              <select value={form.employment_type} onChange={(e) => setForm((f) => ({ ...f, employment_type: e.target.value }))} className={field}>
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="contractual">Contractual</option>
                <option value="probationary">Probationary</option>
              </select>
            </div>
            <div>
              <label className={label}>Hire Date</label>
              <input type="date" value={form.hire_date} onChange={(e) => setForm((f) => ({ ...f, hire_date: e.target.value }))} className={field} />
            </div>
            <div>
              <label className={label}>End Date</label>
              <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className={field} />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="active" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
              <label htmlFor="active" className="text-sm text-slate-700 dark:text-slate-300">Active</label>
            </div>
          </div>
          <div className="mt-4">
            <label className={label}>Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className={field} />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create employee'}
          </button>
        </div>
      </form>
    </div>
  );
}
