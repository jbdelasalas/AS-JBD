'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface POLine {
  id: string;
  line_no: number;
  item_id: string | null;
  gl_account_id: string | null;
  description: string;
  quantity: number;
  qty_received: number;
  unit_price: number;
  vat_rate: number;
  line_total: number;
  item_sku: string | null;
  item_name: string | null;
  gl_account_code: string | null;
  gl_account_name: string | null;
  branch_code: string | null;
  building_code: string | null;
  cost_center_code: string | null;
  grow_ref_code: string | null;
}

interface PO {
  id: string;
  po_no: string;
  po_date: string;
  expected_date: string | null;
  remarks: string | null;
  supplier_name: string;
  supplier_code: string;
  supplier_id: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  status: string;
  branch_code: string | null;
  branch_name: string | null;
  building_code: string | null;
  building_name: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  grow_ref_code: string | null;
  grow_ref_name: string | null;
  lines: POLine[];
}

interface BillRow {
  id: string;
  internal_no: string;
  bill_no: string;
  bill_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
  supplier_name: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft:            'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  approved:         'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  partial:          'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  received:         'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  closed:           'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  cancelled:        'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

const BILL_STATUS: Record<string, string> = {
  draft:            'bg-slate-100 text-slate-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved:         'bg-blue-100 text-blue-700',
  partial:          'bg-orange-100 text-orange-700',
  paid:             'bg-emerald-100 text-emerald-700',
  voided:           'bg-red-100 text-red-700',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100">{value || <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

export default function PODetailPage() {
  const { id } = useParams<{ id: string }>();
  const [po, setPo] = useState<PO | null>(null);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') ?? '' : '';

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<PO>(`/purchasing/purchase-orders/${id}`),
      api.get<{ data: BillRow[] }>(`/ap/bills?company_id=${companyId}&po_id=${id}`),
    ]).then(([p, b]) => { setPo(p); setBills(b.data); })
      .finally(() => setLoading(false));
  }, [id, companyId]);

  useEffect(() => { load(); }, [load]);

  async function doAction(action: string) {
    setBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/purchasing/purchase-orders/${id}/${action}`);
      load();
    } catch (e: unknown) {
      setActionMsg((e as Error).message ?? 'Action failed');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!po) return <div className="py-10 text-center text-sm text-red-600">Purchase order not found</div>;

  const isTerminal = ['received', 'closed', 'cancelled'].includes(po.status);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{po.po_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[po.status] ?? STATUS_STYLES.draft}`}>
              {po.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            <Link href={`/dashboard/purchasing/suppliers/${po.supplier_id}`} className="hover:underline">
              {po.supplier_name}
            </Link>
          </p>
        </div>
        <Link href="/dashboard/purchasing/purchase-orders"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          ← Back to list
        </Link>
      </div>

      {actionMsg && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {actionMsg}
        </div>
      )}

      {/* PO Details */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">PO Details</div>
        <div className="grid grid-cols-4 gap-x-6 gap-y-4">
          <div className="col-span-2">
            <Field label="Supplier" value={`${po.supplier_code} — ${po.supplier_name}`} />
          </div>
          <Field label="PO Date" value={formatDate(po.po_date)} />
          <Field label="Expected Delivery" value={po.expected_date ? formatDate(po.expected_date) : null} />
          <div className="col-span-4">
            <Field label="Remarks" value={po.remarks} />
          </div>
          {(po.branch_code || po.building_code || po.cost_center_code || po.grow_ref_code) && (
            <>
              {po.branch_code && <Field label="Branch" value={`${po.branch_code} — ${po.branch_name}`} />}
              {po.building_code && <Field label="Building" value={`${po.building_code} — ${po.building_name}`} />}
              {po.cost_center_code && <Field label="Cost Center" value={`${po.cost_center_code} — ${po.cost_center_name}`} />}
              {po.grow_ref_code && <Field label="Grow Reference" value={`${po.grow_ref_code} — ${po.grow_ref_name}`} />}
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
                <th className="px-3 py-2 text-left font-medium">Item / Account</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium w-20">Qty</th>
                <th className="px-3 py-2 text-right font-medium w-20">Received</th>
                <th className="px-3 py-2 text-right font-medium w-28">Unit Price</th>
                <th className="px-3 py-2 text-right font-medium w-12">VAT%</th>
                <th className="px-3 py-2 text-right font-medium w-28">Total</th>
                <th className="px-3 py-2 text-left font-medium w-20">Location</th>
                <th className="px-3 py-2 text-left font-medium w-20">Building</th>
                <th className="px-3 py-2 text-left font-medium w-24">Cost Center</th>
                <th className="px-3 py-2 text-left font-medium w-20">Grow</th>
              </tr>
            </thead>
            <tbody>
              {po.lines?.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                  <td className="px-3 py-2 dark:text-slate-300">
                    {l.item_id
                      ? <span className="font-mono text-xs text-slate-500">{l.item_sku}</span>
                      : l.gl_account_code
                        ? <span className="font-mono text-xs text-slate-500">{l.gl_account_code}</span>
                        : <span className="text-slate-400">—</span>
                    }
                  </td>
                  <td className="px-3 py-2 dark:text-slate-300">
                    {l.description}
                    {l.item_name && <span className="ml-1 text-slate-400">({l.item_name})</span>}
                    {l.gl_account_name && <span className="ml-1 text-slate-400">({l.gl_account_name})</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{l.quantity}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <span className={l.qty_received >= l.quantity ? 'text-emerald-600' : l.qty_received > 0 ? 'text-amber-600' : 'text-slate-400'}>
                      {l.qty_received}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(l.unit_price)}</td>
                  <td className="px-3 py-2 text-right dark:text-slate-300">{l.vat_rate}%</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold dark:text-slate-300">{formatPHP(l.line_total)}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{l.branch_code ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{l.building_code ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{l.cost_center_code ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{l.grow_ref_code ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={7} className="px-3 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">Subtotal</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs dark:text-slate-300">{formatPHP(po.subtotal)}</td>
                <td colSpan={4} />
              </tr>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={7} className="px-3 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">VAT</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs dark:text-slate-300">{formatPHP(po.vat_amount)}</td>
                <td colSpan={4} />
              </tr>
              <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <td colSpan={7} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total</td>
                <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(po.total)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Action buttons — mirrors the form footer */}
      {!isTerminal && (
        <div className="flex gap-3">
          {po.status === 'draft' && (
            <button onClick={() => doAction('submit')} disabled={busy}
              className="rounded bg-amber-600 px-5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              {busy ? 'Submitting…' : 'Submit for Approval'}
            </button>
          )}
          {po.status === 'pending_approval' && (
            <button onClick={() => doAction('approve')} disabled={busy}
              className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'Approving…' : 'Approve'}
            </button>
          )}
          {po.status === 'approved' && (
            <Link href={`/dashboard/purchasing/goods-receipts/new?po_id=${id}`}
              className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Receive Goods
            </Link>
          )}
          <button onClick={() => doAction('cancel')} disabled={busy}
            className="rounded border border-red-300 px-5 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">
            {busy ? 'Cancelling…' : 'Cancel PO'}
          </button>
        </div>
      )}

      {/* Related Bills */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Bills
        </div>
        {bills.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs text-slate-400">No bills linked to this PO.</div>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Internal No.</th>
                <th className="px-3 py-2 text-left font-medium">Bill No.</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Due</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/ap/bills/${b.id}`} className="font-mono text-brand-700 hover:underline dark:text-brand-400">{b.internal_no}</Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">{b.bill_no}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatDate(b.bill_date)}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatDate(b.due_date)}</td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(b.total)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700 dark:text-amber-400">{formatPHP(b.balance)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${BILL_STATUS[b.status] ?? BILL_STATUS.draft}`}>
                      {b.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
