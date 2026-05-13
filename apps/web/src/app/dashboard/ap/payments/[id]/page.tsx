'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface Application {
  id: string;
  bill_id: string;
  internal_no: string;
  bill_no: string;
  bill_date: string;
  amount_applied: number;
}

interface Payment {
  id: string;
  voucher_no: string;
  payment_date: string;
  payment_method: string;
  reference: string | null;
  amount: number;
  status: string;
  supplier_name: string;
  supplier_code: string;
  supplier_id: string;
  applications: Application[];
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  posted: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Payment>(`/ap/payments/${id}`).then(setPayment).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function doPost() {
    setBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/ap/payments/${id}/post`);
      load();
    } catch (e: unknown) {
      setActionMsg((e as Error).message ?? 'Failed');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!payment) return <div className="py-10 text-center text-sm text-red-600">Payment not found</div>;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{payment.voucher_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[payment.status] ?? STATUS_STYLES.draft}`}>
              {payment.status}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            <Link href={`/dashboard/purchasing/suppliers/${payment.supplier_id}`} className="hover:underline">
              {payment.supplier_name}
            </Link>
          </p>
        </div>
        {payment.status === 'draft' && (
          <button onClick={doPost} disabled={busy}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
            Post Payment
          </button>
        )}
      </div>

      {actionMsg && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{actionMsg}</div>
      )}

      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: 'Payment Date', value: formatDate(payment.payment_date) },
          { label: 'Method', value: payment.payment_method.replace(/_/g, ' ') },
          { label: 'Reference', value: payment.reference ?? '—' },
          { label: 'Amount', value: formatPHP(payment.amount) },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">{f.label}</div>
            <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100 capitalize">{f.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Bill Applications
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Internal no.</th>
              <th className="px-3 py-2 text-left font-medium">Supplier Bill no.</th>
              <th className="px-3 py-2 text-left font-medium">Bill Date</th>
              <th className="px-3 py-2 text-right font-medium">Applied</th>
            </tr>
          </thead>
          <tbody>
            {payment.applications.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-500">No bills applied — unapplied payment.</td></tr>
            ) : payment.applications.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-3 py-2">
                  <Link href={`/dashboard/ap/bills/${a.bill_id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">
                    {a.internal_no}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{a.bill_no}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(a.bill_date)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">{formatPHP(a.amount_applied)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <td colSpan={3} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total Payment</td>
              <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(payment.amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
