"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BirFiling } from '@perpet/shared';

const FORMS = [
  { code: '2550M',   name: 'Monthly VAT',               period_type: 'monthly' },
  { code: '2550Q',   name: 'Quarterly VAT Return',       period_type: 'quarterly' },
  { code: '1601-EQ', name: 'Quarterly EWT',              period_type: 'quarterly' },
  { code: '0619-E',  name: 'Monthly EWT',                period_type: 'monthly' },
  { code: '1601-C',  name: 'Monthly WHT Compensation',   period_type: 'monthly' },
  { code: '1604-E',  name: 'Annual EWT Return',          period_type: 'annual' },
  { code: '1702Q',   name: 'Quarterly Income Tax',       period_type: 'quarterly' },
  { code: '1702RT',  name: 'Annual Income Tax',          period_type: 'annual' },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function BirFilingsPage() {
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<BirFiling[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<BirFiling | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filing, setFiling] = useState(false);

  const [form, setForm] = useState({
    form_code: '2550Q',
    period_type: 'quarterly',
    period_year: new Date().getFullYear(),
    period_month: '',
    period_quarter: '',
    due_date: '',
    notes: '',
  });

  const [patchForm, setPatchForm] = useState({
    status: 'filed',
    filed_date: new Date().toISOString().slice(0, 10),
    reference_no: '',
    total_paid: '',
  });

  useEffect(() => {
    const stored = localStorage.getItem('selected_company_id');
    if (stored) setCompanyId(stored);
  }, []);

  useEffect(() => { if (companyId) load(); }, [companyId, filterYear]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/bir/filings?company_id=${companyId}&year=${filterYear}`) as BirFiling[];
      setRows(Array.isArray(res) ? res : []);
    } catch { setRows([]); } finally { setLoading(false); }
  }

  async function createFiling() {
    setSaving(true); setError('');
    try {
      await api.post('/bir/filings', {
        ...form,
        company_id: companyId,
        period_month: form.period_month ? parseInt(form.period_month) : null,
        period_quarter: form.period_quarter ? parseInt(form.period_quarter) : null,
      });
      setShowNew(false);
      load();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function markFiled() {
    if (!selected) return;
    setFiling(true); setError('');
    try {
      await api.patch(`/bir/filings/${selected.id}`, {
        ...patchForm,
        total_paid: patchForm.total_paid ? Number(patchForm.total_paid) : undefined,
      });
      setSelected(null);
      load();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setFiling(false); }
  }

  const statusColor = (s: string) => ({
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
    ready: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    filed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    amended: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  }[s] ?? 'bg-slate-100 text-slate-600');

  const periodLabel = (f: BirFiling) => {
    if (f.period_month) return `${MONTHS[f.period_month - 1]} ${f.period_year}`;
    if (f.period_quarter) return `Q${f.period_quarter} ${f.period_year}`;
    return String(f.period_year);
  };

  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Filing Calendar</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Track BIR returns: VAT, EWT, income tax, and others</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + New Filing
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              {['Form','Name','Period','Due Date','Status','Amount Due','Amount Paid','Reference',''].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No filings found. Add filings for {filterYear}.</td></tr>}
            {rows.map((f) => (
              <tr key={f.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2 font-mono text-xs font-semibold text-blue-700 dark:text-blue-300">{f.form_code}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300 text-xs">{f.form_name}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">{periodLabel(f)}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">{f.due_date}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(f.status)}`}>{f.status}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">{f.total_due.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono text-green-700 dark:text-green-400">{f.total_paid.toFixed(2)}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{f.reference_no ?? '—'}</td>
                <td className="px-3 py-2">
                  {f.status !== 'filed' && (
                    <button onClick={() => { setSelected(f); setPatchForm({ status: 'filed', filed_date: new Date().toISOString().slice(0,10), reference_no: '', total_paid: String(f.total_due) }); }}
                      className="text-xs text-blue-600 hover:underline dark:text-blue-400">Mark Filed</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New filing modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-slate-900 shadow-xl p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">Schedule Filing</h2>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">BIR Form</label>
                <select value={form.form_code} onChange={(e) => {
                  const f = FORMS.find((x) => x.code === e.target.value);
                  setForm((prev) => ({ ...prev, form_code: e.target.value, period_type: f?.period_type ?? 'quarterly' }));
                }} className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
                  {FORMS.map((f) => <option key={f.code} value={f.code}>{f.code} — {f.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Year</label>
                  <input type="number" value={form.period_year} onChange={(e) => setForm((f) => ({ ...f, period_year: parseInt(e.target.value) }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
                </div>
                {form.period_type === 'monthly' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Month</label>
                    <select value={form.period_month} onChange={(e) => setForm((f) => ({ ...f, period_month: e.target.value }))}
                      className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
                      <option value="">Select</option>
                      {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                    </select>
                  </div>
                )}
                {form.period_type === 'quarterly' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Quarter</label>
                    <select value={form.period_quarter} onChange={(e) => setForm((f) => ({ ...f, period_quarter: e.target.value }))}
                      className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
                      <option value="">Select</option>
                      {[1,2,3,4].map((q) => <option key={q} value={String(q)}>Q{q}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Due Date *</label>
                <input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Notes</label>
                <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                  placeholder="Optional notes" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setShowNew(false); setError(''); }}
                className="rounded px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">Cancel</button>
              <button onClick={createFiling} disabled={saving}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark filed modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white dark:bg-slate-900 shadow-xl p-6">
            <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Mark as Filed — {selected.form_code}</h2>
            {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Filed Date</label>
                <input type="date" value={patchForm.filed_date} onChange={(e) => setPatchForm((f) => ({ ...f, filed_date: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">BIR Reference No.</label>
                <input type="text" value={patchForm.reference_no} onChange={(e) => setPatchForm((f) => ({ ...f, reference_no: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                  placeholder="Confirmation / trace number" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Amount Paid (₱)</label>
                <input type="number" value={patchForm.total_paid} onChange={(e) => setPatchForm((f) => ({ ...f, total_paid: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setSelected(null); setError(''); }}
                className="rounded px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300">Cancel</button>
              <button onClick={markFiled} disabled={filing}
                className="rounded bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
                {filing ? 'Saving…' : 'Confirm Filed'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
