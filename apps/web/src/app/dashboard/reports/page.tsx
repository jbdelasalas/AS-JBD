"use client";

import Link from 'next/link';

const REPORT_GROUPS = [
  {
    label: 'Financial Statements',
    color: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20',
    reports: [
      { href: '/dashboard/reports/trial-balance',    label: 'Trial Balance',    desc: 'Debit/credit by account as of any date' },
      { href: '/dashboard/reports/income-statement', label: 'Income Statement', desc: 'Profit & loss for a period' },
    ],
  },
  {
    label: 'Receivables',
    color: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20',
    reports: [
      { href: '/dashboard/reports/ar-aging', label: 'AR Aging', desc: 'Outstanding invoices by age bucket' },
    ],
  },
  {
    label: 'Payables',
    color: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20',
    reports: [
      { href: '/dashboard/reports/ap-aging', label: 'AP Aging', desc: 'Outstanding bills by age bucket' },
    ],
  },
  {
    label: 'Sales & VAT',
    color: 'border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20',
    reports: [
      { href: '/dashboard/reports/sales', label: 'Sales Register', desc: 'Daily / monthly sales with VAT breakdown' },
    ],
  },
];

export default function ReportsHomePage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Reports</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Financial statements, AR/AP aging, sales register, and BIR-linked reports.
      </p>

      <div className="space-y-6">
        {REPORT_GROUPS.map((g) => (
          <div key={g.label} className={`rounded-lg border p-4 ${g.color}`}>
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">{g.label}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.reports.map((r) => (
                <Link key={r.href} href={r.href}
                  className="rounded-md border border-white/60 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-sm hover:shadow-md transition">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{r.label}</div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{r.desc}</div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-500 dark:text-slate-400">
        All reports read from posted journal entries only. Use the <strong>as of</strong> date for point-in-time views.
        Run <code className="rounded bg-white dark:bg-slate-900 px-1 py-0.5 font-mono">/api/v1/health</code> to verify migrations 015–017 are applied.
      </div>
    </div>
  );
}
