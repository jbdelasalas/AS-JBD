'use client';

import Link from 'next/link';

const CARDS = [
  {
    href: '/dashboard/fuel/tanks',
    title: 'Tanks',
    desc: 'Storage tanks per warehouse, capacities, and the latest dip reading.',
  },
  {
    href: '/dashboard/fuel/deliveries',
    title: 'Deliveries',
    desc: 'Inbound fuel from refinery/supplier. Received litres at 15°C post to inventory.',
  },
];

export default function FuelHomePage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Fuel Operations</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Perpet fuel distribution &amp; retailing — tanks, dip readings, deliveries, pump shifts and reconciliation.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          >
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{c.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{c.desc}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        <span className="font-medium text-slate-700 dark:text-slate-300">Coming next:</span>{' '}
        dispensing pumps &amp; totaliser readings, retail shift reconciliation, and tank book-vs-measured
        reconciliation with GL posting. The database schema for these already exists.
      </div>
    </div>
  );
}
