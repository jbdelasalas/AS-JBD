'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface EmpRow {
  id: string;
  employee_no: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  employment_type: string;
  department_name: string | null;
  hire_date: string | null;
  is_active: boolean;
  user_email: string | null;
}

const EMP_TYPE_LABEL: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contractual: 'Contractual',
  probationary: 'Probationary',
};

export default function EmployeesPage() {
  const [rows, setRows] = useState<EmpRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load(q = '') {
    const companyId = localStorage.getItem('company_id') ?? '';
    setLoading(true);
    api.get<EmpRow[]>(`/admin/employees?company_id=${companyId}&search=${encodeURIComponent(q)}`)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Employee Master Data</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Manage employee records linked to system users.</p>
        </div>
        <Link href="/dashboard/admin/employees/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          + New employee
        </Link>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); load(search); }} className="mb-4 flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, employee no, or email…"
          className="flex-1 rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        <button type="submit"
          className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
          Search
        </button>
      </form>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Employee No</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Department</th>
              <th className="px-3 py-2 text-left font-medium">Position</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">User Account</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">No employees found.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{r.employee_no}</td>
                <td className="px-3 py-2">
                  <Link href={`/dashboard/admin/employees/${r.id}`}
                    className="font-medium text-brand-700 dark:text-brand-400 hover:underline">
                    {r.full_name}
                  </Link>
                  {r.email && <div className="text-xs text-slate-500 dark:text-slate-400">{r.email}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.department_name ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{r.position ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                  {EMP_TYPE_LABEL[r.employment_type] ?? r.employment_type}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.user_email ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 dark:text-slate-400'}`}>
                    {r.is_active ? 'active' : 'inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
