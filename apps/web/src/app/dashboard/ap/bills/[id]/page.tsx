'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface Payment {
  id: string;
  voucher_no: string;
  payment_date: string;
  payment_method: string;
  amount: number;
  amount_applied: number;
  status: string;
}

interface BillLine {
  id: string;
  line_no: number;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
  account_name: string | null;
  account_code: string | null;
}

interface Bill {
  id: string;
  internal_no: string;
  bill_no: string;
  bill_date: string;
  due_date: string;
  supplier_name: string;
  supplier_code: string;
  supplier_id: string;
  po_id: string | null;
  subtotal: number;
  vat_amount: number;
  ewt_amount: number;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
  lines: BillLine[];
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  partial: 'bg-orange-100 text-orange-700',
  paid: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bill, setBill] = useState<Bill | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') ?? '' : '';

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<Bill>(`/ap/bills/${id}`),
      api.get<{ data: Payment[] }>(`/ap/payments?company_id=${companyId}&bill_id=${id}`),
    ]).then(([b, pay]) => { setBill(b); setPayments(pay.data); })
      .finally(() => setLoading(false));
  }, [id, companyId]);

  useEffect(() => { load(); }, [load]);

  async function doAction(action: string) {
    setBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/ap/bills/${id}/${action}`);
      load();
    } catch (e: unknown) {
      setActionMsg((e as Error).message ?? 'Action failed');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!bill) return <div className="py-10 text-center text-sm text-red-600">Bill not found</div>;

  const paidPct = bill.total > 0 ? Math.min((bill.amount_paid / bill.total) * 100, 100) : 0;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{bill.internal_no}</h1>
            <span className="text-sm text-slate-500 dark:text-slate-400">({bill.bill_no})</span>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[bill.status] ?? STATUS_STYLES.draft}`}>
              {bill.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            <Link href={`/dashboard/purchasing/suppliers/${bill.supplier_id}`} className="hover:underline">
              {bill.supplier_name}
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          {['draft','pending_approval'].includes(bill.status) && (
            <button onClick={() => doAction('approve')} disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
              Approve
            </button>
          )}
          {bill.status === 'approved' && bill.balance > 0 && (
            <Link href={`/dashboard/ap/payments/new?supplier_id=${bill.supplier_id}`}
              className="rounded border border-brand-600 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50 dark:text-brand-400">
              Record Payment
            </Link>
          )}
          {['draft','approved'].includes(bill.status) && bill.amount_paid === 0 && (
            <button onClick={() => doAction('void')} disabled={busy}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400">
              Void
            </button>
          )}
        </div>
      </div>

      {actionMsg && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{actionMsg}</div>
      )}

      {bill.status !== 'draft' && bill.status !== 'voided' && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-1 flex justify-between text-xs text-slate-600 dark:text-slate-400">
            <span>Payment Progress</span>
            <span>{paidPct.toFixed(1)}% paid</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700">
            <div
              className={`h-2 rounded-full transition-all ${paidPct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`}
              style={{ width: `${paidPct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Paid: {formatPHP(bill.amount_paid)}</span>
            <span>Balance: {formatPHP(bill.balance)}</span>
          </div>
        </div>
      )}

      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: 'Bill Date', value: formatDate(bill.bill_date) },
          { label: 'Due Date', value: formatDate(bill.due_date) },
          { label: 'PO Reference', value: bill.po_id ? 'Linked' : '—' },
          { label: 'Supplier Code', value: bill.supplier_code },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">{f.label}</div>
            <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{f.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">Bill Lines</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-left font-medium">Account</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit Price</th>
              <th className="px-3 py-2 text-right font-medium">VAT %</th>
              <th className="px-3 py-2 text-right font-medium">Subtotal</th>
              <th className="px-3 py-2 text-right font-medium">VAT</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines?.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 dark:text-slate-300">{l.description}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  {l.account_code ? `${l.account_code} ${l.account_name}` : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs dark:text-slate-300">{l.quantity}</td>
                <td className="px-3 py-2 text-right font-mono text-xs dark:text-slate-300">{formatPHP(l.unit_price)}</td>
                <td className="px-3 py-2 text-right text-xs dark:text-slate-300">{l.vat_rate}%</td>
                <td className="px-3 py-2 text-right font-mono text-xs dark:text-slate-300">{formatPHP(l.line_subtotal)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs dark:text-slate-300">{formatPHP(l.line_vat)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold dark:text-slate-300">{formatPHP(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {[
              { label: 'Subtotal', value: bill.subtotal },
              { label: 'VAT', value: bill.vat_amount },
            ].map((row) => (
              <tr key={row.label} className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={8} className="px-3 py-1.5 text-right text-xs text-slate-600 dark:text-slate-400">{row.label}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs dark:text-slate-300">{formatPHP(row.value)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <td colSpan={8} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total</td>
              <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(bill.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Payments Applied */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Payments Applied
        </div>
        {payments.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-400">No payments recorded yet.</div>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Voucher No.</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Method</th>
                <th className="px-3 py-2 text-right font-medium">Applied</th>
                <th className="px-3 py-2 text-right font-medium">Total Payment</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/ap/payments/${p.id}`} className="text-brand-700 hover:underline dark:text-brand-400">{p.voucher_no}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatDate(p.payment_date)}</td>
                  <td className="px-3 py-2 capitalize text-slate-600 dark:text-slate-400">{p.payment_method?.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700">{formatPHP(p.amount_applied)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500 dark:text-slate-400">{formatPHP(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
