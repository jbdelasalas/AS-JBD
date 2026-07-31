'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Employee { id: string; employee_no: string; full_name: string; }
interface Account  { id: string; code: string; name: string; account_type: string; }
interface Supplier { id: string; code: string; name: string; tin: string | null; is_vat_registered: boolean; }
interface TaxCode  { id: string; code: string; name: string; tax_type: string; }
interface Dept     { id: string; name: string; }
interface CostCenter { id: string; code: string; name: string; }

interface Line {
  expense_account_id: string;
  supplier_id: string;
  supplier_tin: string;
  tax_code_id: string;
  description: string;
  receipt_date: string;
  amount: number;
  notes: string;
}

const today = new Date().toISOString().split('T')[0];
const EMPTY_LINE: Line = {
  expense_account_id: '', supplier_id: '', supplier_tin: '', tax_code_id: '',
  description: '', receipt_date: today, amount: 0, notes: '',
};

function NewExpenseReportForm() {
  const router = useRouter();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [accounts, setAccounts]   = useState<Account[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [taxCodes, setTaxCodes]   = useState<TaxCode[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [form, setForm] = useState({
    employee_id: '',
    report_date: today,
    period_from: '',
    period_to: '',
    department: '',
    fund_class: '',
    report_class: '',
    location_text: '',
    external_id_code: '',
    pcf_series: '',
  });

  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    Promise.all([
      api.get<Employee[]>(`/admin/employees?company_id=${cid}`),
      api.get<Account[]>(`/gl/accounts?company_id=${cid}&limit=500`),
      api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${cid}&limit=1000`),
      api.get<TaxCode[]>(`/bir/tax-codes?company_id=${cid}`),
      api.get<Dept[]>(`/admin/departments?company_id=${cid}`),
      api.get<CostCenter[]>(`/admin/cost-centers?company_id=${cid}`),
    ]).then(([emps, accs, sups, tcs, depts, ccs]) => {
      setEmployees(Array.isArray(emps) ? emps.filter(e => (e as unknown as Record<string,unknown>).is_active !== false) : []);
      setAccounts(Array.isArray(accs) ? accs.filter(a => a.account_type === 'EXPENSE') : []);
      setSuppliers(sups?.data ?? []);
      // Expense lines are purchases → only Input VAT codes apply.
      setTaxCodes(Array.isArray(tcs) ? tcs.filter(t => t.tax_type === 'vat_input') : []);
      setDepartments(Array.isArray(depts) ? depts : []);
      setCostCenters(Array.isArray(ccs) ? ccs : []);
    }).catch(() => {});
  }, []);

  // Pick a supplier on a line → auto-fill its TIN.
  function pickSupplier(idx: number, supplierId: string) {
    const s = suppliers.find((x) => x.id === supplierId);
    setLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], supplier_id: supplierId, supplier_tin: s?.tin ?? '' };
      return next;
    });
  }

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
        department:       form.department       || undefined,
        fund_class:       form.fund_class       || undefined,
        report_class:     form.report_class     || undefined,
        location_text:    form.location_text    || undefined,
        external_id_code: form.external_id_code || undefined,
        pcf_series:       form.pcf_series        || undefined,
        lines: lines.map(l => ({
          ...l,
          expense_account_id: l.expense_account_id || undefined,
          supplier_id: l.supplier_id || undefined,
          supplier_tin: l.supplier_tin || undefined,
          tax_code_id: l.tax_code_id || undefined,
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

  // Right-aligned bold label + boxed field, matching the PPC Replenishment
  // Report header layout.
  const hlbl = 'w-28 shrink-0 text-left text-xs font-semibold text-slate-600 dark:text-slate-400';
  const hbox = 'min-w-0 flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  const companyName = typeof window !== 'undefined'
    ? (localStorage.getItem('company_name') ?? '')
    : '';

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
        {/* Header — styled like the PPC Replenishment Report template */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-center text-base font-semibold text-slate-900 dark:text-slate-100">
            Expense Report
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 lg:grid-cols-3">
            {/* ── Column 1: Name / Dept / Company ── */}
            <div className="flex items-center gap-2">
              <div className={hlbl}>Name:</div>
              <select required value={form.employee_id}
                onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
                className={hbox}>
                <option value="">Select employee…</option>
                {employees.map(em => (
                  <option key={em.id} value={em.id}>{em.employee_no} — {em.full_name}</option>
                ))}
              </select>
            </div>

            {/* ── Column 2: Fund-Class / Class / Location ── */}
            <div className="flex items-center gap-2">
              <div className={hlbl}>Fund - Class:</div>
              <input type="text" value={form.fund_class}
                onChange={e => setForm(f => ({ ...f, fund_class: e.target.value }))}
                placeholder="Operation - AFCC"
                className={hbox} />
            </div>

            {/* ── Column 3: Date / Period From / Period To / External ID / PCF Series ── */}
            <div className="flex items-center gap-2">
              <div className={hlbl}>Date:</div>
              <input required type="date" value={form.report_date}
                onChange={e => {
                  const d = e.target.value;
                  const prev = form.report_date;
                  setForm(f => ({ ...f, report_date: d }));
                  // Auto-fill every line date that still matched the old header date.
                  setLines(ls => ls.map(l => (!l.receipt_date || l.receipt_date === prev ? { ...l, receipt_date: d } : l)));
                }}
                className={hbox} />
            </div>

            <div className="flex items-center gap-2">
              <div className={hlbl}>Dept.:</div>
              <select value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                className={hbox}>
                <option value="">— select —</option>
                {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className={hlbl}>Class:</div>
              <select value={form.report_class}
                onChange={e => setForm(f => ({ ...f, report_class: e.target.value }))}
                className={hbox}>
                <option value="">— select —</option>
                {costCenters.map(cc => <option key={cc.id} value={cc.name}>{cc.code} — {cc.name}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className={hlbl}>Period From:</div>
              <input type="date" value={form.period_from}
                onChange={e => setForm(f => ({ ...f, period_from: e.target.value }))}
                className={hbox} />
            </div>

            <div className="flex items-center gap-2">
              <div className={hlbl}>Company:</div>
              <div className={hbox + ' bg-slate-100 dark:bg-slate-700/60'}>
                {companyName || <span className="text-slate-400">—</span>}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className={hlbl}>Location:</div>
              <input type="text" value={form.location_text}
                onChange={e => setForm(f => ({ ...f, location_text: e.target.value }))}
                placeholder="CHICKEN TRADING - ALAM"
                className={hbox} />
            </div>

            <div className="flex items-center gap-2">
              <div className={hlbl}>Period To:</div>
              <input type="date" value={form.period_to}
                onChange={e => setForm(f => ({ ...f, period_to: e.target.value }))}
                className={hbox} />
            </div>

            {/* row 4 — External ID / PCF Series sit in column 3 */}
            <div className="hidden lg:block" />
            <div className="hidden lg:block" />
            <div className="flex items-center gap-2">
              <div className={hlbl}>External ID Code:</div>
              <input type="text" value={form.external_id_code}
                onChange={e => setForm(f => ({ ...f, external_id_code: e.target.value }))}
                className={hbox + ' bg-slate-200 font-semibold dark:bg-slate-700'} />
            </div>

            <div className="hidden lg:block" />
            <div className="hidden lg:block" />
            <div className="flex items-center gap-2">
              <div className={hlbl}>PCF Series:</div>
              <input type="text" value={form.pcf_series}
                onChange={e => setForm(f => ({ ...f, pcf_series: e.target.value }))}
                className={hbox + ' bg-slate-200 font-semibold dark:bg-slate-700'} />
            </div>
          </div>

        </div>

        {/* Lines */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Expense Lines</div>
            <button type="button"
              onClick={() => setLines(l => [...l, { ...EMPTY_LINE, receipt_date: form.report_date }])}
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
                  <th className="px-2 py-1.5 text-left font-medium w-44">Supplier</th>
                  <th className="px-2 py-1.5 text-left font-medium w-36">TIN</th>
                  <th className="px-2 py-1.5 text-left font-medium w-36">VAT Code</th>
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
                      <select value={l.supplier_id}
                        onChange={e => pickSupplier(idx, e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        <option value="">— select —</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={l.supplier_tin} readOnly
                        placeholder="—"
                        className="w-full rounded border border-slate-200 bg-slate-50 px-1 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300" />
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.tax_code_id}
                        onChange={e => updateLine(idx, 'tax_code_id', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        <option value="">—</option>
                        {taxCodes.map(t => <option key={t.id} value={t.id}>{t.code}</option>)}
                      </select>
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
                  <td colSpan={6} className="px-2 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Total</td>
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
