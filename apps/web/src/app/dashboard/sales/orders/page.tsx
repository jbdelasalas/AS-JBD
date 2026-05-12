'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface SORow {
  id: string;
  order_no: string;
  order_date: string;
  delivery_date: string | null;
  customer_name: string;
  customer_code: string;
  total: number;
  status: string;
  credit_checked: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  draft:                'bg-slate-100 text-slate-700',
  pending_approval:     'bg-amber-100 text-amber-700',
  approved:             'bg-blue-100 text-blue-700',
  partially_delivered:  'bg-orange-100 text-orange-700',
  fully_delivered:      'bg-emerald-100 text-emerald-700',
  closed:               'bg-purple-100 text-purple-700',
  cancelled:            'bg-red-100 text-red-700',
};

const STATUSES = ['all','draft','pending_approval','approved','partially_delivered','fully_delivered','closed','cancelled'] as const;

export default function SalesOrdersPage() {
  const [rows, setRows] = useState<SORow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('all');

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    const q = status === 'all'
      ? `/sales/orders?company_id=${companyId}&limit=100`
      : `/sales/orders?company_id=${companyId}&status=${status}&limit=100`;
    api.get<{ data: SORow[] }>(q)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Sales Orders</h1>
          <p className="text-sm text-slate-600">Track customer orders from approval to delivery.</p>
        </div>
        <Link
          href="/dashboard/sales/orders/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + New order
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              status === s
                ? 'bg-brand-600 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Order no.</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Customer</th>
              <th className="px-3 py-2 text-left font-medium">Delivery date</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-500">
                  No sales orders found. Click <em>+ New order</em> to create one.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/sales/orders/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                      {r.order_no}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{formatDate(r.order_date)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{r.customer_name}</div>
                    <div className="text-xs text-slate-500">{r.customer_code}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {r.delivery_date ? formatDate(r.delivery_date) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-900">{formatPHP(r.total)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
