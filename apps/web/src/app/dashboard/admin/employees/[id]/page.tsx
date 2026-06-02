'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Employee {
  id: string; employee_no: string; full_name: string; email: string | null;
  phone: string | null; position: string | null; employment_type: string;
  hire_date: string | null; end_date: string | null; is_active: boolean;
  notes: string | null; department_id: string | null; department_name: string | null;
  user_id: string | null; user_email: string | null; user_full_name: string | null;
}
interface UserOption { id: string; full_name: string; email: string; }
interface DeptOption { id: string; name: string; }

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [form, setForm] = useState<Partial<Employee>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id') ?? '';
    Promise.all([
      api.get<Employee>(`/admin/employees/${id}`),
      api.get<UserOption[]>(`/admin/users?company_id=${companyId}`),
      api.get<DeptOption[]>(`/admin/departments?company_id=${companyId}`),
    ]).then(([e, u, d]) => {
      setEmp(e); setUsers(u); setDepartments(d);
      setForm({
        full_name: e.full_name, email: e.email ?? '', phone: e.phone ?? '',
        position: e.position ?? '', employment_type: e.employment_type,
        hire_date: e.hire_date ? e.hire_date.slice(0, 10) : '',
        end_date: e.end_date ? e.end_date.slice(0, 10) : '',
        department_id: e.department_id ?? '', user_id: e.user_id ?? '',
        is_active: e.is_active, notes: e.notes ?? '',
      });
    }).catch((e) => setError(e.message));
  }, [id]);

  async function save() {
    setSaving(true); setError(null);
    try {
      await api.patch(`/admin/employees/${id}`, {
        ...form,
        department_id: form.department_id || null,
        user_id: form.user_id || null,
        hire_date: form.hire_date || null,
        end_date: form.end_date || null,
        email: form.email || null,
        phone: form.phone || null,
        notes: form.notes || null,
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  if (!emp) return <div className="py-8 text-center text-sm text-slate-500">{error ?? 'Loading…'}</div>;

  const field = 'w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100';
  const label = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{emp.full_name}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{emp.employee_no}</p>
        </div>
        <button onClick={() => router.back()}
          className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
          Back
        </button>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="space-y-5">
        {/* User account link */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">System User Account</h2>
          <select value={form.user_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))} className={field}>
            <option value="">— No user account —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
          </select>
        </div>

        {/* Basic info */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Basic Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Full Name</label>
              <input value={form.full_name ?? ''} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} className={field} />
            </div>
            <div>
              <label className={label}>Employee No</label>
              <input value={emp.employee_no} disabled className={`${field} bg-slate-50 dark:bg-slate-800 text-slate-400`} />
            </div>
            <div>
              <label className={label}>Email</label>
              <input type="email" value={form.email ?? ''} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={field} />
            </div>
            <div>
              <label className={label}>Phone</label>
              <input value={form.phone ?? ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={field} />
            </div>
          </div>
        </div>

        {/* Employment details */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Employment Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Department</label>
              <select value={form.department_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))} className={field}>
                <option value="">— None —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Position / Job Title</label>
              <input value={form.position ?? ''} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} className={field} />
            </div>
            <div>
              <label className={label}>Employment Type</label>
              <select value={form.employment_type ?? 'full_time'} onChange={(e) => setForm((f) => ({ ...f, employment_type: e.target.value }))} className={field}>
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="contractual">Contractual</option>
                <option value="probationary">Probationary</option>
              </select>
            </div>
            <div>
              <label className={label}>Hire Date</label>
              <input type="date" value={form.hire_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, hire_date: e.target.value }))} className={field} />
            </div>
            <div>
              <label className={label}>End Date</label>
              <input type="date" value={form.end_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className={field} />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="active" checked={form.is_active ?? true} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
              <label htmlFor="active" className="text-sm text-slate-700 dark:text-slate-300">Active</label>
            </div>
          </div>
          <div className="mt-4">
            <label className={label}>Notes</label>
            <textarea value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className={field} />
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
