'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import JournalPreviewModal from '@/components/JournalPreviewModal';

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
  ewt_rate: number;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
  ewt_amount: number;
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
  po_no: string | null;
  subtotal: number;
  vat_amount: number;
  ewt_amount: number;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
  branch_code: string | null;
  branch_name: string | null;
  building_code: string | null;
  building_name: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  grow_ref_code: string | null;
  grow_ref_name: string | null;
  ewt_code_id: string | null;
  ewt_code: string | null;
  ewt_code_name: string | null;
  ewt_code_rate: number | null;
  ewt_atc_code: string | null;
  je_id: string | null;
  lines: BillLine[];
}

const STATUS_STYLES: Record<string, string> = {
  draft:            'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  approved:         'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  partial:          'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  paid:             'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  voided:           'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

interface WhtCert {
  id: string;
  cert_no: string;
  status: string;
  amount_withheld: number;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100">{value || <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bill, setBill] = useState<Bill | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [cert, setCert] = useState<WhtCert | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [showJEPreview, setShowJEPreview] = useState(false);

  // Initialise companyId once on mount from localStorage — keeps `load` stable
  useEffect(() => {
    setCompanyId(localStorage.getItem('company_id') ?? '');
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const b = await api.get<Bill>(`/ap/bills/${id}`);
      setBill(b);
      // Secondary data — silent failures are fine
      const [pay, certs] = await Promise.all([
        api.get<{ data: Payment[] }>(`/ap/payments?company_id=${companyId}&bill_id=${id}`).catch(() => ({ data: [] as Payment[] })),
        api.get<WhtCert[]>(`/bir/certificates?company_id=${companyId}&bill_id=${id}`).catch(() => [] as WhtCert[]),
      ]);
      setPayments(pay.data);
      setCert((Array.isArray(certs) ? certs : [])[0] ?? null);
    } catch (e: unknown) {
      setLoadError((e as Error).message ?? 'Failed to load bill');
    } finally {
      setLoading(false);
    }
  }, [id, companyId]);

  useEffect(() => { void load(); }, [load]);

  async function doAction(action: string) {
    setBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/ap/bills/${id}/${action}`);
      void load();
    } catch (e: unknown) {
      setActionMsg((e as Error).message ?? 'Action failed');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (loadError || !bill) return (
    <div className="py-10 text-center text-sm text-red-600">{loadError ?? 'Bill not found'}</div>
  );

  const paidPct = bill.total > 0 ? Math.min((bill.amount_paid / bill.total) * 100, 100) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
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
        <Link href="/dashboard/ap/bills"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          ← Back to list
        </Link>
      </div>

      {actionMsg && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {actionMsg}
        </div>
      )}

      {/* Bill Details */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Bill Details</div>
        <div className="grid grid-cols-4 gap-x-6 gap-y-4">
          <div className="col-span-2">
            <Field label="Supplier" value={`${bill.supplier_code} — ${bill.supplier_name}`} />
          </div>
          <Field label="Bill Date" value={formatDate(bill.bill_date)} />
          <Field label="Due Date" value={bill.due_date ? formatDate(bill.due_date) : null} />
          <Field label="Supplier Invoice No." value={bill.bill_no} />
          <Field
            label="PO Reference"
            value={bill.po_id
              ? <Link href={`/dashboard/purchasing/purchase-orders/${bill.po_id}`} className="font-mono text-brand-700 hover:underline dark:text-brand-400">{bill.po_no ?? bill.po_id}</Link>
              : null}
          />
          {bill.ewt_code_id && (
            <div className="col-span-2">
              <div className="mb-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">EWT Code (Withholding Tax)</div>
              <div className="text-sm text-amber-900 dark:text-amber-200">
                <span className="font-mono font-semibold">{bill.ewt_code}</span>
                {' — '}{bill.ewt_code_name}
                {' · '}<span className="font-semibold">{bill.ewt_code_rate != null ? Number(bill.ewt_code_rate) : ''}%</span>
                {bill.ewt_atc_code && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs dark:bg-amber-900">ATC: {bill.ewt_atc_code}</span>}
              </div>
            </div>
          )}
          {(bill.branch_code || bill.building_code || bill.cost_center_code || bill.grow_ref_code) && (
            <>
              {bill.branch_code && <Field label="Branch" value={`${bill.branch_code} — ${bill.branch_name}`} />}
              {bill.building_code && <Field label="Building" value={`${bill.building_code} — ${bill.building_name}`} />}
              {bill.cost_center_code && <Field label="Cost Center" value={`${bill.cost_center_code} — ${bill.cost_center_name}`} />}
              {bill.grow_ref_code && <Field label="Grow Reference" value={`${bill.grow_ref_code} — ${bill.grow_ref_name}`} />}
            </>
          )}
        </div>
      </div>

      {/* Line Items */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Line Items
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-8">#</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-left font-medium w-36">Account</th>
                <th className="px-3 py-2 text-right font-medium w-16">Qty</th>
                <th className="px-3 py-2 text-right font-medium w-28">Unit Price</th>
                <th className="px-3 py-2 text-right font-medium w-12">VAT%</th>
                <th className="px-3 py-2 text-right font-medium w-12">EWT%</th>
                <th className="px-3 py-2 text-right font-medium w-28">Subtotal</th>
                <th className="px-3 py-2 text-right font-medium w-24">VAT</th>
                <th className="px-3 py-2 text-right font-medium w-24">EWT</th>
                <th className="px-3 py-2 text-right font-medium w-28">Total</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines?.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                  <td className="px-3 py-2 dark:text-slate-300">{l.description}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                    {l.account_code ? <span className="font-mono">{l.account_code}</span> : <span className="text-slate-400">—</span>}
                    {l.account_name && <span className="ml-1 text-slate-400">({l.account_name})</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{l.quantity}</td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(l.unit_price)}</td>
                  <td className="px-3 py-2 text-right dark:text-slate-300">{l.vat_rate}%</td>
                  <td className="px-3 py-2 text-right dark:text-slate-300">{l.ewt_rate}%</td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(l.line_subtotal)}</td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(l.line_vat)}</td>
                  <td className="px-3 py-2 text-right font-mono text-amber-700 dark:text-amber-400">{l.ewt_amount > 0 ? formatPHP(l.ewt_amount) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold dark:text-slate-300">{formatPHP(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={7} className="px-3 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">Subtotal</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs dark:text-slate-300">{formatPHP(bill.subtotal)}</td>
                <td colSpan={3} />
              </tr>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={7} className="px-3 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">VAT</td>
                <td colSpan={2} className="px-3 py-1.5 text-right font-mono text-xs dark:text-slate-300">{formatPHP(bill.vat_amount)}</td>
                <td colSpan={2} />
              </tr>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={7} className="px-3 py-1.5 text-right text-xs font-medium text-slate-600 dark:text-slate-300">Gross Total (incl. VAT)</td>
                <td colSpan={2} className="px-3 py-1.5 text-right font-mono text-xs font-medium dark:text-slate-300">{formatPHP(bill.total)}</td>
                <td colSpan={2} />
              </tr>
              {bill.ewt_amount > 0 && (
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <td colSpan={9} className="px-3 py-1.5 text-right text-xs text-amber-700 dark:text-amber-400">
                    Less: EWT Withheld{bill.ewt_code ? ` (${bill.ewt_code} · ${bill.ewt_code_rate != null ? Number(bill.ewt_code_rate) : ''}%)` : ''}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs text-amber-700 dark:text-amber-400">({formatPHP(bill.ewt_amount)})</td>
                  <td />
                </tr>
              )}
              <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <td colSpan={9} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {bill.ewt_amount > 0 ? 'Net Payable to Supplier' : 'Total'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                  {formatPHP(bill.total - bill.ewt_amount)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* BIR Form 2307 / EWT Certificate */}
      {cert && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
          <div className="border-b border-amber-200 px-5 py-3 text-sm font-medium text-amber-800 dark:border-amber-800 dark:text-amber-300">
            EWT Certificate — BIR Form 2307
          </div>
          <div className="grid grid-cols-4 gap-x-6 gap-y-4 p-5">
            <div>
              <div className="mb-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Certificate No.</div>
              <div className="font-mono text-sm text-amber-900 dark:text-amber-200">{cert.cert_no}</div>
            </div>
            <div>
              <div className="mb-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Status</div>
              <div className="text-sm capitalize text-amber-900 dark:text-amber-200">{cert.status}</div>
            </div>
            <div>
              <div className="mb-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Amount Withheld</div>
              <div className="font-mono text-sm font-semibold text-amber-900 dark:text-amber-200">
                ₱{cert.amount_withheld.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="flex items-end">
              <Link href={`/dashboard/bir/certificates/${cert.id}`}
                className="text-sm font-medium text-amber-800 hover:underline dark:text-amber-300">
                View Certificate →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        {['draft', 'pending_approval'].includes(bill.status) && (
          <button onClick={() => setShowJEPreview(true)} disabled={busy}
            className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            Approve
          </button>
        )}
        {bill.je_id && (
          <Link href={`/dashboard/gl/journal-entries/${bill.je_id}`}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            View Journal Entry
          </Link>
        )}
        {bill.status === 'approved' && bill.balance > 0 && (
          <Link href={`/dashboard/ap/payments/new?supplier_id=${bill.supplier_id}`}
            className="rounded border border-brand-600 px-5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950">
            Record Payment
          </Link>
        )}
        {['draft', 'approved'].includes(bill.status) && bill.amount_paid === 0 && (
          <button onClick={() => doAction('void')} disabled={busy}
            className="rounded border border-red-300 px-5 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">
            Void
          </button>
        )}
      </div>

      {/* Payment Progress */}
      {bill.status !== 'draft' && bill.status !== 'voided' && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
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

      {/* Payments Applied */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Payments Applied
        </div>
        {payments.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs text-slate-400">No payments recorded yet.</div>
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
                    <Link href={`/dashboard/ap/payments/${p.id}`} className="font-mono text-brand-700 hover:underline dark:text-brand-400">{p.voucher_no}</Link>
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

      {showJEPreview && (
        <JournalPreviewModal
          previewUrl={`/ap/bills/${id}/journal-preview`}
          confirmLabel="Confirm Approve Bill"
          busy={busy}
          onConfirm={async () => { await doAction('approve'); setShowJEPreview(false); }}
          onCancel={() => setShowJEPreview(false)}
        />
      )}
    </div>
  );
}
