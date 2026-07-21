'use client';

import Link from 'next/link';

const CARDS = [
  { href: '/dashboard/dressing-plant/job-orders',  title: 'Job Orders', desc: 'The batch. Every operation and bill keys off a job order (batch) and its tolling client.' },
  { href: '/dashboard/dressing-plant/receiving',   title: 'Receiving & Weighing', desc: 'Live-bird receiving: gross/tare, head & coop counts, DOA. Recording it locks the batch.' },
  { href: '/dashboard/dressing-plant/yield',       title: 'Yield & WIP', desc: 'Dressed recovery, offal, condemned. Live recovery % with mass-balance & recovery alerts.' },
  { href: '/dashboard/dressing-plant/marination',  title: 'Marination', desc: 'Recipe BOM explosion consumes ingredient inventory and posts Dr 5220 / Cr 1145.' },
  { href: '/dashboard/dressing-plant/cold-chain',  title: 'Cold Chain', desc: 'Storage boxes with barcode UUIDs. Hourly storage clock accrues daily rental.' },
  { href: '/dashboard/dressing-plant/invoices',    title: 'Invoices', desc: 'Basic-tolling invoicing through the posting engine — idempotent Dr 1130 AR / Cr 4100.' },
  { href: '/dashboard/dressing-plant/dispatch',    title: 'Dispatch & Gate', desc: 'Delivery orders + gate pass. Release is blocked until accounting clears and boxes scan.' },
  { href: '/dashboard/dressing-plant/maintenance', title: 'Sanitation & PM', desc: 'Sanitation chemical consumption, machinery runtime and maintenance work orders.' },
];

export default function DressingPlantHome() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Dressing Plant</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Poultry tolling operations — receiving, yield, marination, cold chain, invoicing, dispatch and
          maintenance. Operations write facts; a single posting engine derives the accounting.
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
        <span className="font-medium text-slate-700 dark:text-slate-300">Two keys tie it together:</span>{' '}
        every operational row carries a <span className="font-mono">batch_id</span> (the job order); every
        billable row also carries a <span className="font-mono">client_id</span>. Postings run through
        <span className="font-mono"> dp_post_journal()</span> into the shared General Ledger.
      </div>
    </div>
  );
}
