'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface FieldReq {
  id: string; form_key: string; field_key: string; label: string;
  required: boolean; sort_order: number;
}

// Friendly names for the known forms.
const FORM_LABELS: Record<string, string> = {
  expense_report: 'Expense Report — Header',
  expense_report_line: 'Expense Report — Line',
};

export default function FieldRequirementsPage() {
  const [rows, setRows] = useState<FieldReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formKey, setFormKey] = useState('');

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: FieldReq[] }>(`/admin/field-requirements?company_id=${companyId}`)
      .then((r) => {
        setRows(r.data);
        setFormKey((prev) => prev || r.data[0]?.form_key || '');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const forms = [...new Set(rows.map((r) => r.form_key))];
  const visible = rows.filter((r) => r.form_key === formKey);

  function toggle(id: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, required: !r.required } : r)));
    setSaved(false);
  }

  async function save() {
    if (!companyId) return;
    setSaving(true); setError(null);
    try {
      await api.put('/admin/field-requirements', {
        company_id: companyId,
        items: visible.map((r) => ({ id: r.id, required: r.required })),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Required Fields</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Choose which fields are mandatory on each form. Forms enforce these on save.</p>
        </div>
        <Link href="/dashboard/admin" className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400">← Admin</Link>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {saved && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Saved.</div>}

      <div className="mb-4">
        <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Form</label>
        <select value={formKey} onChange={(e) => setFormKey(e.target.value)}
          className="w-full max-w-sm rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          {forms.length === 0 && <option value="">No forms configured</option>}
          {forms.map((f) => <option key={f} value={f}>{FORM_LABELS[f] ?? f}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Field</th>
              <th className="px-3 py-2 text-right">Required</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={2} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={2} className="px-3 py-6 text-center text-xs text-slate-400">No fields for this form.</td></tr>
            ) : visible.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-slate-800 dark:text-slate-200">
                  {r.label}
                  <span className="ml-2 font-mono text-[11px] text-slate-400">{r.field_key}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button" role="switch" aria-checked={r.required}
                    onClick={() => toggle(r.id)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.required ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${r.required ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <button onClick={save} disabled={saving || visible.length === 0}
          className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
