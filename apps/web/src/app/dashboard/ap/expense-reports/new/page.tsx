'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Employee { id: string; employee_no: string; full_name: string; }
interface Account  { id: string; code: string; name: string; account_type: string; }

interface Line {
  expense_account_id: string;
  description: string;
  receipt_date: string;
  amount: number;
  notes: string;
}

const today = new Date().toISOString().split('T')[0];
const EMPTY_LINE: Line = { expense_account_id: '', description: '', receipt_date: today, amount: 0, notes: '' };

function NewExpenseReportForm() {
  const router = useRouter();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [accounts, setAccounts]   = useState<Account[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [form, setForm] = useState({
    employee_id: '',
    report_date: today,
    period_from: '',
    period_to: '',
    purpose: '',
    notes: '',
  });

  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    Promise.all([
      api.get<Employee[]>(`/admin/employees?company_id=${cid}`),
      api.get<Account[]>(`/gl/accounts?company_id=${cid}&limit=500`),
    ]).then(([emps, accs]) => {
      setEmployees(Array.isArray(emps) ? emps.filter(e => (e as unknown as Record<string,unknown>).is_active !== false) : []);
      setAccounts(Array.isArray(accs) ? accs.filter(a => a.account_type === 'EXPENSE') : []);
    }).catch(() => {});
  }, []);

  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  }

  const grandTotal = lines.reduce((s, l) => s + Number(l.amount || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.employee_id) { setError('Select an employee'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const er = await api.post<{ id: string }>('/ap/expense-reports', {
        company_id: cid,
        employee_id: form.employee_id,
        report_date: form.report_date,
        period_from:  form.period_from  || undefined,
        period_to:    form.period_to    || undefined,
        purpose:      form.purpose      || undefined,
        notes:        form.notes        || undefined,
        lines: lines.map(l => ({
          ...l,
          expense_account_id: l.expense_account_id || undefined,
          notes: l.notes || undefined,
        })),
      });
      router.push(`/dashboard/ap/expense-reports/${er.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  }

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Expense Report</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Submit an employee expense reimbursement request.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Header */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Report Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className={lbl}>Employee *</label>
              <select required value={form.employee_id}
                onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
                className={inp}>
                <option value="">Select employee…</option>
                {employees.map(em => (
                  <option key={em.id} value={em.id}>{em.employee_no} — {em.full_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={lbl}>Report Date *</label>
              <input required type="date" value={form.report_date}
                onChange={e => setForm(f => ({ ...f, report_date: e.target.value }))}
                className={inp} />
            </div>

            <div>
              <label className={lbl}>Period From</label>
              <input type="date" value={form.period_from}
                onChange={e => setForm(f => ({ ...f, period_from: e.target.value }))}
                className={inp} />
            </div>

            <div>
              <label className={lbl}>Period To</label>
              <input type="date" value={form.period_to}
                onChange={e => setForm(f => ({ ...f, period_to: e.target.value }))}
                className={inp} />
            </div>

            <div>
              <label className={lbl}>Purpose</label>
              <input type="text" value={form.purpose}
                onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                placeholder="Business travel, office supplies…"
                className={inp} />
            </div>

            <div className="col-span-3">
              <label className={lbl}>Notes</label>
              <textarea rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className={inp} />
            </div>
          </div>
        </div>

        {/* Lines */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Expense Lines</div>
            <button type="button"
              onClick={() => setLines(l => [...l, { ...EMPTY_LINE }])}
              className="text-xs text-brand-600 hover:underline dark:text-brand-400">
              + Add line
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium w-48">Expense Account</th>
                  <th className="px-2 py-1.5 text-left font-medium">Description *</th>
                  <th className="px-2 py-1.5 text-left font-medium w-32">Receipt Date *</th>
                  <th className="px-2 py-1.5 text-right font-medium w-28">Amount *</th>
                  <th className="px-2 py-1.5 text-left font-medium w-40">Notes</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-1">
                      <select value={l.expense_account_id}
                        onChange={e => updateLine(idx, 'expense_account_id', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        <option value="">— select —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input required type="text" value={l.description}
                        onChange={e => updateLine(idx, 'description', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <input required type="date" value={l.receipt_date}
                        onChange={e => updateLine(idx, 'receipt_date', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <input required type="number" min={0} step="0.01" value={l.amount}
                        onChange={e => updateLine(idx, 'amount', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={l.notes}
                        onChange={e => updateLine(idx, 'notes', e.target.value)}
                        placeholder="Optional"
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {lines.length > 1 && (
                        <button type="button"
                          onClick={() => setLines(ls => ls.filter((_, i) => i !== idx))}
                          className="text-red-500 hover:text-red-700">×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <td colSpan={3} className="px-2 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Total</td>
                  <td className="px-2 py-2 text-right font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                    ₱{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewExpenseReportPage() {
  return <Suspense><NewExpenseReportForm /></Suspense>;
}
