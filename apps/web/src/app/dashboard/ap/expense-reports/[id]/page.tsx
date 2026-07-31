'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { EmployeeExpenseReport } from '@perpet/shared';

const STATUS_STYLES: Record<string, string> = {
  draft:            'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  approved:         'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  cancelled:        'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

/** Header row styled like the "PPC - Replenishment Report" template:
 *  right-aligned label, value shown in a subtle bordered box.
 *  `highlight` renders the box with a filled/emphasised background
 *  (used for the External ID Code style fields). */
function HeaderRow({
  label, value, highlight = false,
}: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-40 shrink-0 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">
        {label}
      </div>
      <div
        className={
          'min-w-0 flex-1 border px-2 py-1 text-sm ' +
          (highlight
            ? 'border-slate-400 bg-slate-200 font-semibold text-slate-900 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-100'
            : 'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100')
        }
      >
        {value || <span className="text-slate-400">—</span>}
      </div>
    </div>
  );
}

export default function ExpenseReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [er, setEr]           = useState<EmployeeExpenseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState<string | null>(null);
  const [showCancel, setShowCancel]     = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Cash-count / fund accountability
  const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25];
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [checkOnProcess, setCheckOnProcess] = useState('');
  const [unliquidatedCA, setUnliquidatedCA] = useState('');
  const [fundAccountability, setFundAccountability] = useState('');
  const [savingCash, setSavingCash] = useState(false);

  const num = (v: string) => (v === '' || isNaN(Number(v)) ? 0 : Number(v));
  const totalCOH = DENOMS.reduce((s, d) => s + d * num(counts[String(d)] ?? ''), 0);
  // Expense total (sum of the report's lines).
  const expenseTotal = Number(er?.total ?? 0);
  // Total Fund Accounted = expenses + cash on hand + check on process + unliquidated CA.
  const totalFundAccounted = expenseTotal + totalCOH + num(checkOnProcess) + num(unliquidatedCA);
  // Over/(Short) = Total Fund Accounted − Fund Accountability.
  const overShort = totalFundAccounted - num(fundAccountability);

  async function saveCashCount() {
    setSavingCash(true); setMsg(null);
    try {
      await api.patch(`/ap/expense-reports/${id}`, {
        cash_count: {
          denoms: Object.fromEntries(DENOMS.map((d) => [String(d), num(counts[String(d)] ?? '')])),
          expense_total: expenseTotal,
          check_on_process: num(checkOnProcess),
          unliquidated_cash_advance: num(unliquidatedCA),
          total_coh: totalCOH,
          total_fund_accounted: totalFundAccounted,
          over_short: overShort,
        },
        fund_accountability: num(fundAccountability),
      });
      setMsg('Cash count saved.');
      load();
    } catch (e) { setMsg((e as Error).message ?? 'Failed to save cash count'); }
    finally { setSavingCash(false); }
  }

  const load = useCallback(() => {
    setLoading(true);
    api.get<EmployeeExpenseReport>(`/ap/expense-reports/${id}`)
      .then(setEr)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Hydrate the cash-count form from the loaded report.
  useEffect(() => {
    if (!er) return;
    const cc = (er as unknown as { cash_count?: {
      denoms?: Record<string, number>; check_on_process?: number; unliquidated_cash_advance?: number;
    }; fund_accountability?: number });
    if (cc.cash_count?.denoms) {
      const m: Record<string, string> = {};
      for (const [k, v] of Object.entries(cc.cash_count.denoms)) m[k] = v ? String(v) : '';
      setCounts(m);
    }
    if (cc.cash_count?.check_on_process != null) setCheckOnProcess(String(cc.cash_count.check_on_process || ''));
    if (cc.cash_count?.unliquidated_cash_advance != null) setUnliquidatedCA(String(cc.cash_count.unliquidated_cash_advance || ''));
    if (cc.fund_accountability != null) setFundAccountability(String(cc.fund_accountability || ''));
  }, [er]);

  // Print in light mode: dark backgrounds shouldn't carry onto paper.
  function handlePrint() {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    if (wasDark) root.classList.remove('dark');
    const restore = () => {
      if (wasDark) root.classList.add('dark');
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  async function doAction(path: string, body?: object) {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/ap/expense-reports/${id}/${path}`, body ?? {});
      load();
    } catch (e: unknown) {
      setMsg((e as Error).message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  if (!er)     return <div className="py-10 text-center text-sm text-red-600">Expense report not found</div>;

  const jeId = (er as unknown as Record<string, unknown>).je_id as string | null;
  const companyName = typeof window !== 'undefined'
    ? (localStorage.getItem('company_name') ?? '')
    : '';

  return (
    <div className="space-y-5 er-print-root">
      {/* Print styles — print the on-screen layout, scaled to fit one landscape page. */}
      <style>{`
        @media print {
          html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body, main { background: #fff !important; height: auto !important; overflow: visible !important; }
          .h-screen { height: auto !important; }
          .overflow-hidden, .overflow-y-auto { overflow: visible !important; }
          aside, header { display: none !important; }
          main { padding: 0 !important; }
          .print\\:hidden { display: none !important; }
          /* All text prints black */
          .er-print-root, .er-print-root * { color: #000 !important; }
          /* Never print interactive controls (action buttons, save, etc.) */
          .er-print-root button { display: none !important; }
          /* Force the wide (lg) layout on paper */
          .er-print-root .lg\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          .er-print-root .lg\\:flex-row { flex-direction: row !important; }
          .er-print-root .lg\\:items-start { align-items: flex-start !important; }
          .er-print-root .lg\\:col-span-3 { grid-column: span 3 / span 3 !important; }
          .er-print-root .lg\\:block { display: block !important; }
          .er-print-root .lg\\:w-auto { width: auto !important; }
          /* Tighten vertical spacing between and inside cards */
          .er-print-root.space-y-5 > * + * { margin-top: 8px !important; }
          .er-print-root .p-5 { padding: 8px !important; }
          /* Shrink the cash count block: small fonts, compact rows, plain inputs */
          .er-cashcount h2 { margin-bottom: 4px !important; }
          .er-cashcount { font-size: 10px !important; }
          .er-cashcount .gap-8 { gap: 16px !important; }
          .er-cashcount .space-y-10 > * + * { margin-top: 16px !important; }
          .er-cashcount table { font-size: 10px !important; }
          .er-cashcount td, .er-cashcount th { padding-top: 0 !important; padding-bottom: 0 !important; }
          .er-cashcount input {
            width: 3.5rem !important; border: none !important; background: transparent !important;
            padding: 0 !important; font-size: 10px !important; text-align: right !important;
          }
          .er-cashcount .space-y-1\\.5 > * + * { margin-top: 1px !important; }
          .er-cashcount .w-40 { width: 7rem !important; }
          .er-cashcount .text-\\[11px\\], .er-cashcount .text-xs { font-size: 10px !important; }
          /* Push the cash count block to the far right of the page */
          .er-cashcount .gap-8 { width: 100% !important; }
          .er-cc-right { margin-left: auto !important; }
          /* Scale the whole report down so it fits on a single page.
             Do NOT use break-inside:avoid — it forces the cash count onto page 2. */
          .er-print-root { transform: scale(0.82); transform-origin: top left; width: 122%; }
          .er-print-root, .er-print-root * { break-inside: auto !important; }
          @page { size: A4 landscape; margin: 6mm; }
        }
      `}</style>

      {/* Page header (screen only — the report card already shows this info) */}
      <div className="flex items-start justify-between print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{er.er_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[er.status] ?? STATUS_STYLES.draft}`}>
              {er.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {er.employee_name} ({er.employee_no})
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handlePrint}
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 print:hidden">
            Print
          </button>
          <Link href="/dashboard/ap/expense-reports"
            className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 print:hidden">
            ← Back to list
          </Link>
        </div>
      </div>

      {msg && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {msg}
        </div>
      )}

      {/* Report header — styled like the PPC Replenishment Report template */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="mb-4 text-center text-base font-semibold text-slate-900 dark:text-slate-100">
          Expense Report
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 lg:grid-cols-3">
          {/* Column 1 */}
          <HeaderRow label="Name:" value={er.employee_name} />
          {/* Column 2 */}
          <HeaderRow label="Fund - Class:" value={er.fund_class} />
          {/* Column 3 */}
          <HeaderRow label="Date:" value={formatDate(er.report_date)} />

          <HeaderRow label="Dept.:" value={er.department} />
          <HeaderRow label="Class:" value={er.report_class} />
          <HeaderRow
            label="Period Covered From:"
            value={er.period_from ? formatDate(er.period_from) : null}
          />

          <HeaderRow label="Company:" value={companyName} />
          <HeaderRow label="Location:" value={er.location_text} />
          <HeaderRow
            label="Period Covered to:"
            value={er.period_to ? formatDate(er.period_to) : null}
          />

          {/* External ID Code · PCF Series · Status — aligned under Company / Location / Period */}
          <div className="flex items-center gap-2">
            <div className="w-40 shrink-0 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">External ID Code:</div>
            <div className="min-w-0 flex-1 border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100">
              {er.external_id_code || er.er_no}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-40 shrink-0 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">PCF Series:</div>
            <div className="min-w-0 flex-1 border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100">
              {er.pcf_series || <span className="text-slate-400">—</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-40 shrink-0 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">Status:</div>
            <div className="min-w-0 flex-1">
              <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_STYLES[er.status] ?? STATUS_STYLES.draft}`}>
                {er.status.replace(/_/g, ' ')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Expense lines */}
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          Expense Lines
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-8">#</th>
                <th className="px-3 py-2 text-left font-medium w-36">Account</th>
                <th className="px-3 py-2 text-left font-medium w-56">Description</th>
                <th className="px-3 py-2 text-left font-medium w-64">Supplier</th>
                <th className="px-3 py-2 text-left font-medium w-32">TIN</th>
                <th className="px-3 py-2 text-left font-medium w-28">VAT Code</th>
                <th className="px-3 py-2 text-left font-medium w-28">Receipt Date</th>
                <th className="px-3 py-2 text-right font-medium w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {er.lines?.map(l => {
                const ln = l as unknown as Record<string, unknown>;
                return (
                <tr key={l.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                  <td className="px-3 py-2">
                    {l.account_code
                      ? <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{l.account_code}</span>
                      : <span className="text-xs text-slate-400">—</span>}
                    {l.account_name && <span className="ml-1 text-xs text-slate-400">({l.account_name})</span>}
                  </td>
                  <td className="px-3 py-2 dark:text-slate-300">{l.description}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{(ln.supplier_name as string) ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{(ln.supplier_tin as string) ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{(ln.tax_code as string) ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(l.receipt_date)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold dark:text-slate-300">{formatPHP(l.amount)}</td>
                </tr>
              );})}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <td colSpan={7} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total</td>
                <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(er.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Cash count / Fund Accountability */}
      <div className="er-cashcount rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-4 text-right text-xs font-semibold text-slate-800 dark:text-slate-200">Cash Count &amp; Fund Accountability</h2>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        {/* Signature block — shifted toward the center/right */}
        <div className="w-full max-w-md space-y-10 pt-2 lg:ml-40 lg:w-auto">
          <div className="flex items-end gap-3">
            <span className="whitespace-nowrap text-xs text-slate-700 dark:text-slate-300">Prepare by:</span>
            <div className="flex flex-1 flex-col items-center">
              <span className="mb-0.5 text-xs font-semibold text-slate-800 dark:text-slate-200">{er.employee_name}</span>
              <div className="w-full min-w-[16rem] border-b border-slate-500 dark:border-slate-400" />
            </div>
          </div>
          <div className="flex items-end gap-3 pt-6">
            <span className="whitespace-nowrap text-xs text-slate-700 dark:text-slate-300">Approved by:</span>
            <div className="flex flex-1 flex-col items-center">
              <span className="mb-0.5 h-4 text-xs font-semibold text-slate-800 dark:text-slate-200">
                {(er as unknown as Record<string, unknown>).approved_by_name as string ?? ''}
              </span>
              <div className="w-full min-w-[16rem] border-b border-slate-500 dark:border-slate-400" />
            </div>
          </div>
        </div>

        {/* Cash count — right */}
        <div className="er-cc-right w-full max-w-lg lg:w-auto">
          {/* Denomination table */}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-xs text-slate-500 dark:text-slate-400">
                <th className="py-1 text-center font-semibold">Denom</th>
                <th className="py-1 text-center font-semibold">Count</th>
                <th className="py-1 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {DENOMS.map((d) => {
                const cnt = num(counts[String(d)] ?? '');
                const editable = ['draft', 'pending_approval'].includes(er.status);
                return (
                  <tr key={d}>
                    <td className="py-1 text-center font-mono text-xs text-slate-700 dark:text-slate-300">{d.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="py-1 text-center">
                      <input
                        type="number" min="0" value={counts[String(d)] ?? ''}
                        disabled={!editable}
                        onChange={(e) => setCounts((c) => ({ ...c, [String(d)]: e.target.value }))}
                        className="w-24 rounded border border-slate-300 px-2 py-0.5 text-center text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 disabled:opacity-60"
                      />
                    </td>
                    <td className="py-1 text-right font-mono text-xs text-slate-800 dark:text-slate-200">{(d * cnt).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Reconciliation */}
          {(() => {
            const editable = ['draft', 'pending_approval'].includes(er.status);
            const rowLabel = 'text-right text-[11px] font-semibold text-slate-600 dark:text-slate-400';
            const rowVal = 'w-40 border px-2 py-1 text-right font-mono text-xs border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100';
            const inp = 'w-40 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 disabled:bg-slate-50 disabled:opacity-100 dark:disabled:bg-slate-800/60';
            return (
              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-end gap-3">
                  <span className={rowLabel}>Total Amount (Expenses)</span>
                  <div className={rowVal}>{expenseTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <span className={rowLabel}>Total COH</span>
                  <div className={rowVal}>{totalCOH.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <span className={rowLabel}>Check on Process</span>
                  <input type="number" step="0.01" value={checkOnProcess} disabled={!editable}
                    onChange={(e) => setCheckOnProcess(e.target.value)} className={inp} />
                </div>
                <div className="flex items-center justify-end gap-3">
                  <span className={rowLabel}>Unliquidated Cash Advance</span>
                  <input type="number" step="0.01" value={unliquidatedCA} disabled={!editable}
                    onChange={(e) => setUnliquidatedCA(e.target.value)} className={inp} />
                </div>
                <div className="flex items-center justify-end gap-3">
                  <span className={rowLabel}>Total Fund Accounted</span>
                  <div className={`${rowVal} font-semibold`}>{totalFundAccounted.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <span className={rowLabel}>Fund Accountability</span>
                  <input type="number" step="0.01" value={fundAccountability} disabled={!editable}
                    onChange={(e) => setFundAccountability(e.target.value)} className={inp} />
                </div>
                <div className="flex items-center justify-end gap-3">
                  <span className={rowLabel}>Over/(Short)</span>
                  <div className={`${rowVal} font-bold ${overShort < 0 ? 'text-red-600 dark:text-red-400' : overShort > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                    {overShort < 0
                      ? `(${Math.abs(overShort).toLocaleString(undefined, { minimumFractionDigits: 2 })})`
                      : overShort.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
                {editable && (
                  <div className="flex justify-end pt-2">
                    <button onClick={saveCashCount} disabled={savingCash}
                      className="rounded bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 print:hidden">
                      {savingCash ? 'Saving…' : 'Save cash count'}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        </div>
      </div>

      {/* Cancel info */}
      {er.status === 'cancelled' && er.cancel_reason && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-300">
          <span className="font-medium">Cancellation reason: </span>{er.cancel_reason}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 print:hidden">
        {er.status === 'draft' && (
          <button onClick={() => doAction('submit')} disabled={busy}
            className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            Submit for Approval
          </button>
        )}
        {er.status === 'pending_approval' && (
          <button onClick={() => doAction('approve')} disabled={busy}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            Approve
          </button>
        )}
        {jeId && (
          <Link href={`/dashboard/gl/journal-entries/${jeId}`}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            View Journal Entry
          </Link>
        )}
        {['draft', 'pending_approval'].includes(er.status) && (
          <button onClick={() => setShowCancel(true)} disabled={busy}
            className="rounded border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">
            Cancel
          </button>
        )}
      </div>

      {/* Cancel modal */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Cancel Expense Report</h2>
            <textarea rows={3} placeholder="Reason (required)…" value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            <div className="flex gap-2">
              <button disabled={!cancelReason.trim() || busy}
                onClick={() => { setShowCancel(false); doAction('cancel', { reason: cancelReason }); }}
                className="flex-1 rounded bg-red-600 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-40">
                Confirm Cancel
              </button>
              <button onClick={() => setShowCancel(false)}
                className="flex-1 rounded border border-slate-300 py-2 text-sm dark:border-slate-600 dark:text-slate-300">
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
