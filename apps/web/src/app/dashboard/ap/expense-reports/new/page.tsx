'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Employee { id: string; employee_no: string; full_name: string; }
interface Account  { id: string; code: string; name: string; account_type: string; }
/** Location / Cost Center / Building / Grow all share { id, code?, name } from
 *  their admin master-data endpoints. */
interface Ref { id: string; code?: string; name: string; }

/** A line maps to the schema (receipt_date, expense_account, description, amount, notes)
 *  plus the four dimensions (location/cost center/building/grow). payee / supplier /
 *  tin / vat_code remain AFCC display/print-only fields (not persisted). */
interface Line {
  receipt_date: string;
  payee: string;
  supplier: string;
  tin: string;
  description: string;      // Particulars
  expense_account_id: string;
  amount: number;
  vat_code: string;
  notes: string;
  location_id: string;
  cost_center_id: string;
  building_id: string;
  grow_reference_id: string;
}

const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25] as const;

const today = new Date().toISOString().split('T')[0];
const EMPTY_LINE: Line = {
  receipt_date: today, payee: '', supplier: '', tin: '',
  description: '', expense_account_id: '', amount: 0, vat_code: '', notes: '',
  location_id: '', cost_center_id: '', building_id: '', grow_reference_id: '',
};

function NewExpenseReportForm() {
  const router = useRouter();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [accounts, setAccounts]   = useState<Account[]>([]);
  const [locations, setLocations]       = useState<Ref[]>([]);
  const [costCenters, setCostCenters]   = useState<Ref[]>([]);
  const [buildings, setBuildings]       = useState<Ref[]>([]);
  const [grows, setGrows]               = useState<Ref[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [form, setForm] = useState({
    // persisted
    employee_id: '',
    report_date: today,
    period_from: '',
    period_to: '',
    notes: '',
    location_id: '',
    cost_center_id: '',
    building_id: '',
    grow_reference_id: '',
    // AFCC display-only header fields
    dept: '',
    company: '',
    klass: '',
    type: 'REIMBURSEMENT',
    reference_no: '',
    external_id: '',
    er_series: '',
    prepared_by: '',
    approved_by: '',
  });

  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

  // AFCC fund-accountability panel (display/print-only)
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [checkOnProcess, setCheckOnProcess]       = useState(0);
  const [unliquidatedAdvance, setUnliquidated]    = useState(0);

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) { setError('No company selected — please re-login.'); return; }

    // Some endpoints return a bare array, others wrap as { data: [...] }.
    const asArray = <T,>(v: unknown): T[] =>
      Array.isArray(v) ? (v as T[])
      : Array.isArray((v as { data?: unknown })?.data) ? ((v as { data: T[] }).data)
      : [];

    Promise.all([
      api.get<unknown>(`/admin/employees?company_id=${cid}`),
      api.get<unknown>(`/gl/accounts?company_id=${cid}&limit=500`),
      api.get<unknown>(`/inventory/locations?company_id=${cid}`),
      api.get<unknown>(`/admin/cost-centers?company_id=${cid}`),
      api.get<unknown>(`/poultry/buildings?company_id=${cid}`),
      api.get<unknown>(`/poultry/grow-references?company_id=${cid}`),
    ]).then(([empsRaw, accsRaw, locRaw, ccRaw, bldRaw, growRaw]) => {
      const emps = asArray<Employee>(empsRaw).filter(
        e => (e as unknown as Record<string, unknown>).is_active !== false,
      );
      const accs = asArray<Account>(accsRaw).filter(a => a.account_type === 'EXPENSE');
      const active = (r: Ref) => (r as unknown as Record<string, unknown>).is_active !== false;
      setEmployees(emps);
      setAccounts(accs);
      setLocations(asArray<Ref>(locRaw).filter(active));
      setCostCenters(asArray<Ref>(ccRaw).filter(active));
      setBuildings(asArray<Ref>(bldRaw).filter(active));
      setGrows(asArray<Ref>(growRaw).filter(active));
      if (emps.length === 0) setError('No active employees found for this company.');
    }).catch((e: unknown) => {
      setError(`Could not load form data: ${(e as Error).message ?? 'unknown error'}`);
    });
  }, []);

  const refLabel = (r: Ref) => (r.code ? `${r.code} — ${r.name}` : r.name);

  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  }

  const grandTotal = lines.reduce((s, l) => s + Number(l.amount || 0), 0);

  const totalCOH = useMemo(
    () => DENOMS.reduce((s, d) => s + d * (counts[d] || 0), 0),
    [counts],
  );
  const totalFundAccounted = totalCOH + Number(checkOnProcess || 0) + Number(unliquidatedAdvance || 0);
  const overShort = totalFundAccounted - grandTotal;

  const fmt = (n: number) =>
    n ? n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.employee_id) { setError('Select an employee (Name)'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const er = await api.post<{ id: string }>('/ap/expense-reports', {
        company_id: cid,
        employee_id: form.employee_id,
        report_date: form.report_date,
        period_from:  form.period_from  || undefined,
        period_to:    form.period_to    || undefined,
        notes:        form.notes        || undefined,
        location_id:       form.location_id       || undefined,
        cost_center_id:    form.cost_center_id     || undefined,
        building_id:       form.building_id        || undefined,
        grow_reference_id: form.grow_reference_id  || undefined,
        lines: lines.map(l => ({
          expense_account_id: l.expense_account_id || undefined,
          description: l.description,
          receipt_date: l.receipt_date,
          amount: l.amount,
          notes: l.notes || undefined,
          location_id:       l.location_id       || undefined,
          cost_center_id:    l.cost_center_id     || undefined,
          building_id:       l.building_id        || undefined,
          grow_reference_id: l.grow_reference_id  || undefined,
        })),
      });
      router.push(`/dashboard/ap/expense-reports/${er.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  }

  // Shared cell styles to mimic the AFCC spreadsheet look.
  const cell  = 'border border-slate-300 dark:border-slate-600';
  const field = 'w-full bg-transparent px-1.5 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-amber-50 dark:focus:bg-slate-800';
  const lblCell = 'whitespace-nowrap px-1.5 py-1 text-right text-xs font-semibold text-slate-700 dark:text-slate-300';
  const shaded = 'bg-slate-100 dark:bg-slate-800';

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">New Expense Report</h1>
        <span className="text-xs text-slate-500 dark:text-slate-400">AFCC – Expense Report Form</span>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* ===== Form sheet ===== */}
        <div className="border border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-900 p-4">
          <div className="mb-3 text-center text-sm font-bold tracking-wide text-slate-900 dark:text-slate-100">
            AFCC – Expense Report Form
          </div>

          {/* Header: left identity grid + right meta grid */}
          <div className="grid grid-cols-2 gap-x-8">
            {/* Left block */}
            <table className="w-full border-collapse">
              <tbody>
                <tr>
                  <td className={lblCell}>Name:</td>
                  <td className={`${cell} ${shaded}`}>
                    <select required value={form.employee_id}
                      onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
                      className={field}>
                      <option value="">Select employee…</option>
                      {employees.map(em => (
                        <option key={em.id} value={em.id}>{em.employee_no} — {em.full_name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Dept.:</td>
                  <td className={`${cell} ${shaded}`}>
                    <input value={form.dept} onChange={e => setForm(f => ({ ...f, dept: e.target.value }))} className={field} />
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Company:</td>
                  <td className={`${cell} ${shaded}`}>
                    <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} className={field} />
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Class:</td>
                  <td className={`${cell} ${shaded}`}>
                    <input value={form.klass} onChange={e => setForm(f => ({ ...f, klass: e.target.value }))} className={field} />
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Location:</td>
                  <td className={`${cell} ${shaded}`}>
                    <select value={form.location_id}
                      onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))} className={field}>
                      <option value="">— select —</option>
                      {locations.map(r => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
                    </select>
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Cost Center:</td>
                  <td className={`${cell} ${shaded}`}>
                    <select value={form.cost_center_id}
                      onChange={e => setForm(f => ({ ...f, cost_center_id: e.target.value }))} className={field}>
                      <option value="">— select —</option>
                      {costCenters.map(r => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
                    </select>
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Building:</td>
                  <td className={`${cell} ${shaded}`}>
                    <select value={form.building_id}
                      onChange={e => setForm(f => ({ ...f, building_id: e.target.value }))} className={field}>
                      <option value="">— select —</option>
                      {buildings.map(r => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
                    </select>
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Grow:</td>
                  <td className={`${cell} ${shaded}`}>
                    <select value={form.grow_reference_id}
                      onChange={e => setForm(f => ({ ...f, grow_reference_id: e.target.value }))} className={field}>
                      <option value="">— select —</option>
                      {grows.map(r => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Right block */}
            <table className="w-full border-collapse">
              <tbody>
                <tr>
                  <td className={lblCell}>Type:</td>
                  <td className={`${cell} ${shaded}`}>
                    <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={field}>
                      <option>REIMBURSEMENT</option>
                      <option>CASH ADVANCE</option>
                      <option>LIQUIDATION</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Date:</td>
                  <td className={`${cell} ${shaded}`}>
                    <input required type="date" value={form.report_date}
                      onChange={e => setForm(f => ({ ...f, report_date: e.target.value }))} className={field} />
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Reference Number:</td>
                  <td className={`${cell} ${shaded}`}>
                    <input value={form.reference_no} onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))} className={field} />
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Period Covered From:</td>
                  <td className={`${cell} ${shaded}`}>
                    <input type="date" value={form.period_from}
                      onChange={e => setForm(f => ({ ...f, period_from: e.target.value }))} className={field} />
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>Period Covered To:</td>
                  <td className={`${cell} ${shaded}`}>
                    <input type="date" value={form.period_to}
                      onChange={e => setForm(f => ({ ...f, period_to: e.target.value }))} className={field} />
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>External ID Code:</td>
                  <td className={`${cell} ${shaded}`}>
                    <input value={form.external_id} onChange={e => setForm(f => ({ ...f, external_id: e.target.value }))} className={field} />
                  </td>
                </tr>
                <tr>
                  <td className={lblCell}>ER Series:</td>
                  <td className={`${cell} ${shaded}`}>
                    <input value={form.er_series} onChange={e => setForm(f => ({ ...f, er_series: e.target.value }))} className={field} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ===== Line items ===== */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className={`${shaded} text-[11px] font-semibold text-slate-700 dark:text-slate-300`}>
                  <th className={`${cell} px-1.5 py-1 text-left`}>Date</th>
                  <th className={`${cell} px-1.5 py-1 text-left`}>Payee</th>
                  <th className={`${cell} px-1.5 py-1 text-left`}>Supplier</th>
                  <th className={`${cell} px-1.5 py-1 text-left`}>TIN</th>
                  <th className={`${cell} px-1.5 py-1 text-left`}>Particulars</th>
                  <th className={`${cell} px-1.5 py-1 text-left`}>Expense Account</th>
                  <th className={`${cell} px-1.5 py-1 text-left`}>Location</th>
                  <th className={`${cell} px-1.5 py-1 text-left`}>Cost Center</th>
                  <th className={`${cell} px-1.5 py-1 text-left`}>Building</th>
                  <th className={`${cell} px-1.5 py-1 text-left`}>Grow</th>
                  <th className={`${cell} px-1.5 py-1 text-right`}>Amount</th>
                  <th className={`${cell} px-1.5 py-1 text-left`}>Vat Code</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx}>
                    <td className={cell}>
                      <input type="date" value={l.receipt_date}
                        onChange={e => updateLine(idx, 'receipt_date', e.target.value)} className={field} />
                    </td>
                    <td className={cell}>
                      <input value={l.payee} onChange={e => updateLine(idx, 'payee', e.target.value)} className={field} />
                    </td>
                    <td className={cell}>
                      <input value={l.supplier} onChange={e => updateLine(idx, 'supplier', e.target.value)} className={field} />
                    </td>
                    <td className={cell}>
                      <input value={l.tin} onChange={e => updateLine(idx, 'tin', e.target.value)} className={field} />
                    </td>
                    <td className={cell}>
                      <input required value={l.description}
                        onChange={e => updateLine(idx, 'description', e.target.value)} className={field} />
                    </td>
                    <td className={cell}>
                      <select value={l.expense_account_id}
                        onChange={e => updateLine(idx, 'expense_account_id', e.target.value)} className={field}>
                        <option value="">— select —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                      </select>
                    </td>
                    <td className={cell}>
                      <select value={l.location_id}
                        onChange={e => updateLine(idx, 'location_id', e.target.value)} className={field}>
                        <option value="">—</option>
                        {locations.map(r => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
                      </select>
                    </td>
                    <td className={cell}>
                      <select value={l.cost_center_id}
                        onChange={e => updateLine(idx, 'cost_center_id', e.target.value)} className={field}>
                        <option value="">—</option>
                        {costCenters.map(r => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
                      </select>
                    </td>
                    <td className={cell}>
                      <select value={l.building_id}
                        onChange={e => updateLine(idx, 'building_id', e.target.value)} className={field}>
                        <option value="">—</option>
                        {buildings.map(r => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
                      </select>
                    </td>
                    <td className={cell}>
                      <select value={l.grow_reference_id}
                        onChange={e => updateLine(idx, 'grow_reference_id', e.target.value)} className={field}>
                        <option value="">—</option>
                        {grows.map(r => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
                      </select>
                    </td>
                    <td className={cell}>
                      <input type="number" min={0} step="0.01" value={l.amount}
                        onChange={e => updateLine(idx, 'amount', parseFloat(e.target.value) || 0)}
                        className={`${field} text-right`} />
                    </td>
                    <td className={cell}>
                      <input value={l.vat_code} onChange={e => updateLine(idx, 'vat_code', e.target.value)} className={field} />
                    </td>
                    <td className="px-1 text-center">
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
                <tr className={`${shaded} text-xs font-semibold text-slate-800 dark:text-slate-200`}>
                  <td className={`${cell} px-1.5 py-1`}>Total:</td>
                  <td className={cell} colSpan={9} />
                  <td className={`${cell} px-1.5 py-1 text-right font-mono`}>{fmt(grandTotal)}</td>
                  <td className={cell} />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-1">
            <button type="button"
              onClick={() => setLines(l => [...l, { ...EMPTY_LINE }])}
              className="text-xs text-brand-600 hover:underline dark:text-brand-400">
              + Add line
            </button>
          </div>

          {/* ===== Signatures + Fund accountability ===== */}
          <div className="mt-8 grid grid-cols-2 gap-8">
            {/* Signatures */}
            <div className="space-y-10 pt-2 text-xs text-slate-700 dark:text-slate-300">
              <div>
                <div className="mb-6 flex items-end gap-2">
                  <span className="font-semibold">Prepare by:</span>
                  <input value={form.prepared_by}
                    onChange={e => setForm(f => ({ ...f, prepared_by: e.target.value }))}
                    className="flex-1 border-b border-slate-400 bg-transparent px-1 text-center outline-none dark:border-slate-500 dark:text-slate-100" />
                </div>
                <div className="text-center text-[11px] italic text-slate-500 dark:text-slate-400">
                  Custodian&apos;s Name and Signature
                </div>
              </div>
              <div className="flex items-end gap-2">
                <span className="font-semibold">Approved by:</span>
                <input value={form.approved_by}
                  onChange={e => setForm(f => ({ ...f, approved_by: e.target.value }))}
                  className="flex-1 border-b border-slate-400 bg-transparent px-1 text-center outline-none dark:border-slate-500 dark:text-slate-100" />
              </div>
            </div>

            {/* Fund accountability */}
            <div className="text-xs text-slate-700 dark:text-slate-300">
              <div className="mb-2 flex items-center justify-between font-bold">
                <span>Total Amount</span>
                <span className="font-mono">{fmt(grandTotal)}</span>
              </div>

              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-[11px] font-semibold">
                    <th className="px-1 py-0.5 text-right">Denom</th>
                    <th className="px-1 py-0.5 text-center">Count</th>
                    <th className="px-1 py-0.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {DENOMS.map(d => (
                    <tr key={d}>
                      <td className="px-1 py-0.5 text-right font-mono">
                        {d.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-1 py-0.5">
                        <input type="number" min={0} value={counts[d] ?? ''}
                          onChange={e => setCounts(c => ({ ...c, [d]: parseInt(e.target.value) || 0 }))}
                          className="w-full border-b border-slate-300 bg-transparent px-1 text-right outline-none dark:border-slate-600 dark:text-slate-100" />
                      </td>
                      <td className="px-1 py-0.5 text-right font-mono">{fmt(d * (counts[d] || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-2 space-y-1">
                <Row label="Total COH" value={fmt(totalCOH)} bold />
                <RowInput label="Check on Process" value={checkOnProcess} onChange={setCheckOnProcess} />
                <RowInput label="Unliquidated Cash Advance" value={unliquidatedAdvance} onChange={setUnliquidated} />
                <Row label="Total Fund Accounted" value={fmt(totalFundAccounted)} bold />
                <Row label="Fund Accountability" value={fmt(grandTotal)} />
                <Row label="Over(Short)" value={fmt(overShort)} bold />
              </div>
            </div>
          </div>
        </div>

        {/* ===== Actions ===== */}
        <div className="mt-5 flex gap-3">
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between border-t border-slate-200 pt-1 dark:border-slate-700 ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function RowInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between border-t border-slate-200 pt-1 dark:border-slate-700">
      <span>{label}</span>
      <input type="number" min={0} step="0.01" value={value || ''}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-28 border-b border-slate-300 bg-transparent px-1 text-right font-mono outline-none dark:border-slate-600 dark:text-slate-100" />
    </div>
  );
}

export default function NewExpenseReportPage() {
  return <Suspense><NewExpenseReportForm /></Suspense>;
}
