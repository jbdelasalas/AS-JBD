"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { TaxCode } from '@perpet/shared';

const TAX_TYPES = [
  { value: 'vat_output',  label: 'VAT Output',        color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  { value: 'vat_input',   label: 'VAT Input',         color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200' },
  { value: 'ewt',         label: 'EWT (Withholding)', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  { value: 'excise',      label: 'Excise',            color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  { value: 'percentage',  label: 'Percentage Tax',    color: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200' },
];

interface Account { id: string; code: string; name: string; }

export default function BirTaxCodesPage() {
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<TaxCode[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    code: '', name: '', tax_type: 'ewt',
    rate_pct: '', bir_atc_code: '', account_id: '',
  });

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (cid) {
      setCompanyId(cid);
      api.get<Account[]>(`/gl/accounts?company_id=${cid}&limit=500`)
        .then(a => setAccounts(Array.isArray(a) ? a : []))
        .catch(() => {});
    }
  }, []);

  useEffect(() => { if (companyId) load(); }, [companyId, filterType]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        company_id: companyId,
        ...(filterType && { tax_type: filterType }),
      });
      const res = await api.get(`/bir/tax-codes?${qs}`) as TaxCode[];
      setRows(Array.isArray(res) ? res : []);
    } catch { setRows([]); } finally { setLoading(false); }
  }

  async function save() {
    if (!form.code || !form.name || !form.rate_pct) { setError('Code, Name, and Rate are required.'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/bir/tax-codes', {
        ...form,
        company_id: companyId,
        rate_pct: Number(form.rate_pct),
        account_id: form.account_id || null,
        bir_atc_code: form.bir_atc_code || null,
      });
      setShowNew(false);
      setForm({ code: '', name: '', tax_type: 'ewt', rate_pct: '', bir_atc_code: '', account_id: '' });
      load();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  const byType = TAX_TYPES.map((t) => ({
    ...t,
    codes: rows.filter((r) => r.tax_type === t.value),
  }));

  const typeColor = (type: string) => TAX_TYPES.find((t) => t.value === type)?.color ?? 'bg-slate-100 text-slate-700';
  const filtered = filterType ? rows.filter((r) => r.tax_type === filterType) : rows;

  const inp = 'w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100';
  const lbl = 'block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1';

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Tax Codes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">VAT, EWT, excise, and percentage tax codes with BIR ATC mapping</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + New Tax Code
        </button>
      </div>

      {/* Summary by type */}
      <div className="mb-6 grid grid-cols-5 gap-2">
        {byType.map((t) => (
          <button key={t.value} onClick={() => setFilterType(filterType === t.value ? '' : t.value)}
            className={`rounded-lg border p-3 text-left transition ${filterType === t.value ? 'border-blue-400 ring-2 ring-blue-300' : 'border-slate-200 dark:border-slate-700'} bg-white dark:bg-slate-800`}>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{t.codes.length}</div>
            <div className={`mt-1 rounded-full px-1.5 py-0.5 text-xs font-medium w-fit ${t.color}`}>{t.label}</div>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              {['Code','Name','Type','Rate','BIR ATC Code','GL Account','Status'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No tax codes found.</td></tr>}
            {filtered.map((tc) => (
              <tr key={tc.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">{tc.code}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{tc.name}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColor(tc.tax_type)}`}>
                    {TAX_TYPES.find((t) => t.value === tc.tax_type)?.label ?? tc.tax_type}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">{tc.rate_pct}%</td>
                <td className="px-3 py-2 font-mono text-xs text-blue-700 dark:text-blue-300">{tc.bir_atc_code ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  {(tc as unknown as Record<string, unknown>).account_name as string ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tc.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'}`}>
                    {tc.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New tax code modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-lg bg-white dark:bg-slate-900 shadow-xl p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">New Tax Code</h2>
            {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Code *</label>
                  <input type="text" value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    className={inp} placeholder="e.g. WC010" />
                </div>
                <div>
                  <label className={lbl}>Type *</label>
                  <select value={form.tax_type} onChange={(e) => setForm((f) => ({ ...f, tax_type: e.target.value }))} className={inp}>
                    {TAX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={lbl}>Name / Description *</label>
                <input type="text" value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inp} placeholder="e.g. EWT on Professional Fees 10%" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Rate (%) *</label>
                  <input type="number" step="0.0001" min="0" value={form.rate_pct}
                    onChange={(e) => setForm((f) => ({ ...f, rate_pct: e.target.value }))}
                    className={inp} placeholder="e.g. 10" />
                </div>
                <div>
                  <label className={lbl}>BIR ATC Code</label>
                  <input type="text" value={form.bir_atc_code}
                    onChange={(e) => setForm((f) => ({ ...f, bir_atc_code: e.target.value.toUpperCase() }))}
                    className={inp} placeholder="e.g. WC010" />
                </div>
              </div>
              <div>
                <label className={lbl}>GL Account (for journal posting)</label>
                <select value={form.account_id} onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))} className={inp}>
                  <option value="">— none —</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  For EWT codes: link to the "EWT Payable" liability account — credited when withholding is applied on a bill.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => { setShowNew(false); setError(''); }}
                className="rounded px-4 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="rounded bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
