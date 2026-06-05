'use client';

import Link from 'next/link';

const cards = [
  {
    href: '/dashboard/sales/orders',
    title: 'Sales Orders',
    description: 'Create, approve and track customer orders through fulfilment.',
    color: 'border-brand-200 bg-brand-50 text-brand-800',
  },
  {
    href: '/dashboard/sales/delivery-receipts',
    title: 'Delivery Receipts',
    description: 'Post stock deliveries against approved sales orders.',
    color: 'border-brand-200 bg-brand-50 text-brand-800',
  },
  {
    href: '/dashboard/sales/allocations',
    title: 'Order Allocations',
    description: 'Allocate quantities per customer order and create sales tally sheets.',
    color: 'border-brand-200 bg-brand-50 text-brand-800',
  },
];

export default function SalesPage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Sales &amp; CRM</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">Quotes, sales orders and customer fulfilment.</p>

      <div className="grid grid-cols-2 gap-4">
        {cards.map((c) => (
          <Link
            key={c.href + c.title}
            href={c.href}
            className={`rounded-lg border p-5 hover:opacity-80 transition-opacity ${c.color}`}
          >
            <div className="font-medium">{c.title}</div>
            <p className="mt-1 text-xs leading-relaxed opacity-80">{c.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
