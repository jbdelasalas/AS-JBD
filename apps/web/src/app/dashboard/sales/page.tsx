'use client';

import Link from 'next/link';

const cards = [
  {
    href: '/dashboard/sales/orders',
    title: 'Sales Orders',
    description: 'Create, approve and track customer orders through fulfilment.',
    color: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  {
    href: '/dashboard/sales/orders',
    title: 'Delivery Receipts',
    description: 'Post stock deliveries against approved sales orders.',
    color: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
];

export default function SalesPage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Sales &amp; CRM</h1>
      <p className="mb-6 text-sm text-slate-600">Quotes, sales orders and customer fulfilment.</p>

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
