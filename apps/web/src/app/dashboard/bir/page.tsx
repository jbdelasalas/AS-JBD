"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface FilingSummary {
  pending: number;
  overdue: number;
  filed_this_year: number;
}

const BIR_MODULES = [
  { href: '/dashboard/bir/documents',   label: 'Issued Documents', icon: '🧾', desc: 'OR / SI / CI official receipts and sales invoices' },
  { href: '/dashboard/bir/tax-codes',   label: 'Tax Codes',         icon: '🏷️', desc: 'VAT, EWT, excise codes and ATC mapping' },
  { href: '/dashboard/bir/filings',     label: 'Filing Calendar',   icon: '📅', desc: '2550Q, 1601-EQ, 1702Q and other BIR returns' },
  { href: '/dashboard/bir/certificates',label: 'Form 2307',         icon: '📜', desc: 'Withholding tax certificates for suppliers' },
  { href: '/dashboard/bir/books',       label: 'Books of Accounts', icon: '📚', desc: 'Sales book, purchase book, general journal' },
  { href: '/dashboard/bir/sc-pwd',      label: 'SC / PWD',          icon: '♿', desc: 'Senior citizen and PWD discount register' },
];

export default function BirHomePage() {
  const [companyId, setCompanyId] = useState('');
  const [summary, setSummary] = useState<FilingSummary | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('selected_company_id');
    if (stored) setCompanyId(stored);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    api.get(`/bir/filings?company_id=${companyId}&year=${new Date().getFullYear()}`)
      .then((res: unknown) => {
        const data = res as { data?: { status: string }[] } | { status: string }[];
        const filings: { status: string }[] = Array.isArray(data) ? data : ((data as { data?: { status: string }[] }).data ?? []);
        const now = new Date().toISOString().slice(0, 10);
        setSummary({
          pending: filings.filter((f) => f.status === 'draft' || f.status === 'ready').length,
          overdue: 0, // would need due_date comparison
          filed_this_year: filings.filter((f) => f.status === 'filed').length,
        });
      })
      .catch(() => {});
  }, [companyId]);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">BIR Compliance</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        VAT, EWT, official documents, filing calendar — Philippines Bureau of Internal Revenue.
      </p>

      {/* KPI row */}
      {summary && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 p-4">
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{summary.pending}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Pending Filings</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 p-4">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{summary.overdue}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Overdue</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 p-4">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{summary.filed_this_year}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Filed This Year</div>
          </div>
        </div>
      )}

      {/* Module cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {BIR_MODULES.map((m) => (
          <Link key={m.href} href={m.href}
            className="rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition dark:border-slate-700 dark:bg-slate-800">
            <div className="text-2xl mb-2">{m.icon}</div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{m.label}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{m.desc}</div>
          </Link>
        ))}
      </div>

      {/* Compliance references */}
      <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 p-4">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Regulatory References</div>
        <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
          <li>• <strong>RR 11-2024</strong> — Updated VAT rules and e-invoicing requirements</li>
          <li>• <strong>RR 16-2005</strong> — Invoicing and receipting requirements</li>
          <li>• <strong>RR 9-2009</strong> — Subsidiary books and records</li>
          <li>• <strong>RMC 29-2019</strong> — Clarifications on VAT zero-rating</li>
          <li>• <strong>RA 9994 / RA 10754</strong> — SC and PWD discounts</li>
          <li>• <strong>NIRC Sec. 148 (TRAIN)</strong> — Excise tax on petroleum products</li>
        </ul>
      </div>
    </div>
  );
}
