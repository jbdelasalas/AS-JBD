'use client';

import Link from 'next/link';

const MODULES = [
  { href: '/dashboard/admin/master-data/items', label: 'Items',             desc: 'Manage SKUs, categories, costing method, and reorder levels.',       color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/admin/master-data/locations', label: 'Locations',    desc: 'Set up warehouses and storage locations for inventory tracking.',    color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/inventory/stock-on-hand', label: 'Stock On Hand',    desc: 'View current balances and stock values by item and location.',       color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/inventory/adjustments',  label: 'Adjustments',       desc: 'Post stock gains and losses — damage, spoilage, count corrections.', color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/inventory/transfers',    label: 'Transfers',         desc: 'Move stock between locations with full in-transit tracking.',        color: 'border-brand-200 bg-brand-50 text-brand-800' },
  { href: '/dashboard/inventory/counts',       label: 'Stock Counts',      desc: 'Run full, cycle, or spot counts and post count corrections.',        color: 'border-brand-200 bg-brand-50 text-brand-800' },
];

export default function InventoryHomePage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Inventory</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Items, locations, stock movements, adjustments, transfers, and counts.</p>

      <div className="grid grid-cols-2 gap-4">
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href}
            className={`rounded-lg border p-5 transition-opacity hover:opacity-80 ${m.color}`}>
            <div className="font-medium">{m.label}</div>
            <p className="mt-1 text-xs leading-relaxed opacity-80">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
