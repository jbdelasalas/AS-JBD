'use client';

import Link from 'next/link';

export default function GlHome() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">General ledger</h1>
      <p className="mb-6 text-sm text-slate-600">
        Chart of accounts, journal entries, and trial balance.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/dashboard/gl/accounts"
          className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-300"
        >
          <div className="text-sm font-medium text-slate-900">Chart of accounts</div>
          <div className="mt-1 text-xs text-slate-500">Browse, search, add accounts</div>
        </Link>
        <Link
          href="/dashboard/gl/journal-entries"
          className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-300"
        >
          <div className="text-sm font-medium text-slate-900">Journal entries</div>
          <div className="mt-1 text-xs text-slate-500">Create, post, void entries</div>
        </Link>
        <Link
          href="/dashboard/gl/trial-balance"
          className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-300"
        >
          <div className="text-sm font-medium text-slate-900">Trial balance</div>
          <div className="mt-1 text-xs text-slate-500">As-of-date account balances</div>
        </Link>
      </div>
    </div>
  );
}
