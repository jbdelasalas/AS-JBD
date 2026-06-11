'use client';

import Link from 'next/link';

const MODULES = [
  {
    href: '/dashboard/purchasing/purchase-orders',
    label: 'Purchase Orders',
    desc: 'Create, submit, and track purchase orders for restaurant supplies.',
    color: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-900/20 dark:text-brand-300',
  },
  {
    href: '/dashboard/ap/bills',
    label: 'Bills',
    desc: 'Record and manage supplier bills payable by the restaurant.',
    color: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-900/20 dark:text-brand-300',
  },
  {
    href: '/dashboard/ar/invoices',
    label: 'Sales Invoice',
    desc: 'Issue and track sales invoices for restaurant customers.',
    color: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-900/20 dark:text-brand-300',
  },
];

export default function RestaurantHomePage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Restaurant</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">
        Purchase orders, bills, and sales invoices for restaurant operations.
      </p>

      <div className="grid grid-cols-2 gap-4">
        {MODULES.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className={`rounded-lg border p-5 transition-opacity hover:opacity-80 ${m.color}`}
          >
            <div className="font-medium">{m.label}</div>
            <p className="mt-1 text-xs leading-relaxed opacity-80">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
