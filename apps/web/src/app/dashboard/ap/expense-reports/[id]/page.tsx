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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100">{value || <span className="text-slate-400">—</span>}</div>
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

  const load = useCallback(() => {
    setLoading(true);
    api.get<EmployeeExpenseReport>(`/ap/expense-reports/${id}`)
      .then(setEr)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between">
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
        <Link href="/dashboard/ap/expense-reports"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          ← Back to list
        </Link>
      </div>

      {msg && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {msg}
        </div>
      )}

      {/* Details card */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Report Details</div>
        <div className="grid grid-cols-4 gap-x-6 gap-y-4">
          <div className="col-span-2">
            <Field label="Employee" value={`${er.employee_no} — ${er.employee_name}`} />
          </div>
          <Field label="Report Date" value={formatDate(er.report_date)} />
          <Field
            label="Period"
            value={er.period_from
              ? `${formatDate(er.period_from)}${er.period_to ? ` – ${formatDate(er.period_to)}` : ''}`
              : null}
          />
          <div className="col-span-2">
            <Field label="Purpose" value={er.purpose} />
          </div>
          <div className="col-span-2">
            <Field label="Notes" value={er.notes} />
          </div>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Amount</div>
          <div className="mt-0.5 text-xl font-semibold text-slate-900 dark:text-slate-100 font-mono">{formatPHP(er.total)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Lines</div>
          <div className="mt-0.5 text-xl font-semibold text-slate-900 dark:text-slate-100">{er.lines?.length ?? 0}</div>
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
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-left font-medium w-28">Receipt Date</th>
                <th className="px-3 py-2 text-right font-medium w-28">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {er.lines?.map(l => (
                <tr key={l.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                  <td className="px-3 py-2">
                    {l.account_code
                      ? <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{l.account_code}</span>
                      : <span className="text-xs text-slate-400">—</span>}
                    {l.account_name && <span className="ml-1 text-xs text-slate-400">({l.account_name})</span>}
                  </td>
                  <td className="px-3 py-2 dark:text-slate-300">{l.description}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(l.receipt_date)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold dark:text-slate-300">{formatPHP(l.amount)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <td colSpan={4} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total</td>
                <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(er.total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Cancel info */}
      {er.status === 'cancelled' && er.cancel_reason && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-300">
          <span className="font-medium">Cancellation reason: </span>{er.cancel_reason}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
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
