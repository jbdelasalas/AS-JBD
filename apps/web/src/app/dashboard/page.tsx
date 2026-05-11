'use client';

import Link from 'next/link';

const QUICK_LINKS = [
  { href: '/dashboard/gl', label: 'General ledger', desc: 'Chart of accounts, journal entries, trial balance' },
  { href: '/dashboard/ar', label: 'Receivables',     desc: 'Customers, invoices, official receipts' },
  { href: '/dashboard/ap', label: 'Payables',        desc: 'Suppliers, bills, payment vouchers' },
  { href: '/dashboard/fuel', label: 'Fuel ops',      desc: 'Tanks, deliveries, dip readings, reconciliation' },
  { href: '/dashboard/reports', label: 'Reports',    desc: 'Financial statements, aging, variance' },
  { href: '/dashboard/bir', label: 'BIR',            desc: 'VAT, EWT, document series, filing calendar' },
];

export default function DashboardHome() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Dashboard</h1>
      <p className="mb-6 text-sm text-slate-600">
        Welcome to Perpet ERP. Most modules are scaffolds — General Ledger is fully
        functional. See <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">README.md</code> in
        each module folder for what to build next.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_LINKS.map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm"
          >
            <div className="text-sm font-medium text-slate-900">{q.label}</div>
            <div className="mt-1 text-xs text-slate-500">{q.desc}</div>
          </Link>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        <strong>Status:</strong> learning project / scaffolding. Not BIR CAS-PTU
        accredited. Not for production accounting. Validate every posting against a
        spreadsheet during development.
      </div>
    </div>
  );
}
