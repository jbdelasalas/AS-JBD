'use client';

import Link from 'next/link';

const CARD = 'rounded-lg border border-brand-200 bg-brand-50 p-5 transition-opacity hover:opacity-80 dark:border-brand-700 dark:bg-brand-900/20';

const MODULES = [
  { href: '/dashboard/wms/bins',          label: 'Bins',           desc: 'Define zones and bin locations inside each warehouse.' },
  { href: '/dashboard/wms/stock-on-hand', label: 'Bin Stock',      desc: 'See exactly which bin (and lot) every item sits in.' },
  { href: '/dashboard/wms/putaways',      label: 'Put-away',       desc: 'Direct received goods into storage bins.' },
  { href: '/dashboard/wms/pick-lists',    label: 'Pick Lists',     desc: 'Pick and pack stock against sales orders.' },
  { href: '/dashboard/wms/shipments',     label: 'Shipments',      desc: 'Confirm goods-out and issue stock from bins.' },
  { href: '/dashboard/wms/lots',          label: 'Lots & Serials', desc: 'Track lot/batch numbers, expiry, and serial units.' },
];

export default function WmsHomePage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Warehouse Management</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">
        Bin-level storage, put-away, picking, shipping, and lot/serial tracking — layered on top of inventory.
      </p>
      <div className="grid grid-cols-2 gap-4">
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href} className={CARD}>
            <div className="font-medium text-brand-800 dark:text-brand-300">{m.label}</div>
            <p className="mt-1 text-xs leading-relaxed text-brand-800/80 dark:text-brand-300/80">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
