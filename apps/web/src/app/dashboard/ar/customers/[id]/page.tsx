'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { Customer } from '@perpet/shared';

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
}

const SI_STATUS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  open: 'bg-blue-100 text-blue-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<(Customer & { open_ar_balance: number }) | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<Customer & { open_ar_balance: number }>(`/ar/customers/${id}`),
      api.get<InvoiceRow[]>(`/ar/customers/${id}/outstanding`),
    ]).then(([c, inv]) => {
      setCustomer(c);
      setInvoices(inv);
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!customer) return <div className="py-10 text-center text-sm text-red-600">Customer not found</div>;

  const creditUsedPct = customer.credit_limit > 0
    ? Math.min((customer.open_ar_balance / customer.credit_limit) * 100, 100)
    : 0;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{customer.name}</h1>
          <p className="text-sm text-slate-500">{customer.code} · {customer.customer_type}</p>
        </div>
        <Link href={`/dashboard/ar/invoices/new?customer_id=${id}`}
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          New Invoice
        </Link>
      </div>

      {/* Info */}
      <div className="mb-5 grid grid-cols-3 gap-4">
        <div className="col-span-2 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 text-xs font-medium text-slate-600">Contact</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              ['TIN', customer.tin ?? '—'],
              ['Contact', customer.contact_person ?? '—'],
              ['Phone', customer.phone ?? '—'],
              ['Email', customer.email ?? '—'],
              ['Address', customer.address ?? '—'],
              ['VAT Exempt', customer.is_vat_exempt ? 'Yes' : 'No'],
            ].map(([k, v]) => (
              <div key={k}>
                <span className="text-xs text-slate-500">{k}: </span>
                <span className="text-slate-800">{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 text-xs font-medium text-slate-600">AR Status</div>
          <div className="mb-3">
            <div className="text-xs text-slate-500">Open Balance</div>
            <div className="text-xl font-bold text-amber-700">{formatPHP(customer.open_ar_balance)}</div>
          </div>
          {customer.credit_limit > 0 && (
            <>
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Credit used</span>
                <span>{creditUsedPct.toFixed(1)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100">
                <div
                  className={`h-2 rounded-full ${creditUsedPct >= 90 ? 'bg-red-500' : creditUsedPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${creditUsedPct}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Limit: {formatPHP(customer.credit_limit)} · Available: {formatPHP(Math.max(customer.credit_limit - customer.open_ar_balance, 0))}
              </div>
            </>
          )}
          <div className="mt-3 text-xs text-slate-500">
            Payment terms: {customer.payment_terms_days} days
          </div>
        </div>
      </div>

      {/* Outstanding invoices */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700">
          Outstanding Invoices
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Invoice</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">Paid</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500">No outstanding invoices.</td></tr>
            ) : invoices.map((inv) => (
              <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/ar/invoices/${inv.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                    {inv.invoice_no}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">{formatDate(inv.invoice_date)}</td>
                <td className="px-3 py-2 text-xs text-slate-600">{formatDate(inv.due_date)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(inv.total)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(inv.amount_paid)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{formatPHP(inv.balance)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${SI_STATUS[inv.status] ?? SI_STATUS.open}`}>
                    {inv.status.replace(/_/g, ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
