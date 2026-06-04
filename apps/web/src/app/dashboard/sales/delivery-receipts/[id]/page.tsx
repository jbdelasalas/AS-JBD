'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate, formatPHP } from '@/lib/format';

interface DRLine {
  id: string; line_no: number;
  item_id: string; item_sku: string | null; item_name: string | null; item_uom: string | null;
  description: string; qty_delivered: number; unit_cost: number;
  so_unit_price: number | null; so_vat_rate: number | null; so_discount_pct: number | null;
}
interface DR {
  id: string; dr_no: string; delivery_date: string;
  status: string; notes: string | null;
  customer_id: string; customer_name: string; payment_terms_days: number;
  order_no: string; so_id: string; warehouse_name: string;
  tally_sheet_id: string | null;
  eff_branch_id: string | null; eff_building_id: string | null;
  eff_cost_center_id: string | null; eff_grow_reference_id: string | null;
  lines: DRLine[];
}

const STATUS_STYLES: Record<string, string> = {
  draft:  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  posted: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100">{value || <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

export default function DRDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [dr, setDr] = useState<DR | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<DR>(`/sales/delivery-receipts/${id}`).then(setDr).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function doPost() {
    if (!window.confirm('Post this delivery receipt? Stock will be decremented.')) return;
    setBusy(true); setMsg(null);
    try {
      await api.post(`/sales/delivery-receipts/${id}/post`);
      load();
    } catch (e: unknown) { setMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  function goCreateSI() {
    if (!dr) return;
    // Store DR data for the SI new form to pre-fill
    sessionStorage.setItem('pending_si_from_dr', JSON.stringify({
      dr_id: dr.id,
      dr_no: dr.dr_no,
      customer_id: dr.customer_id,
      so_id: dr.so_id,
      invoice_date: dr.delivery_date,
      payment_terms_days: dr.payment_terms_days,
      branch_id: dr.eff_branch_id,
      building_id: dr.eff_building_id,
      cost_center_id: dr.eff_cost_center_id,
      grow_reference_id: dr.eff_grow_reference_id,
      lines: dr.lines.map(l => ({
        item_id: l.item_id,
        description: l.item_name ?? l.description,
        quantity: l.qty_delivered,
        unit_price: l.so_unit_price ?? 0,
        discount_pct: l.so_discount_pct ?? 0,
        vat_rate: l.so_vat_rate ?? 12,
        uom: l.item_uom ?? '',
        grow_reference_id: dr.eff_grow_reference_id ?? '',
      })),
    }));
    router.push('/dashboard/ar/invoices/new');
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!dr) return <div className="py-10 text-center text-sm text-red-600">Delivery receipt not found</div>;

  const totalQty = dr.lines.reduce((s, l) => s + Number(l.qty_delivered), 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{dr.dr_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[dr.status] ?? STATUS_STYLES.draft}`}>
              {dr.status}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{dr.customer_name}</p>
        </div>
        <Link href="/dashboard/sales/delivery-receipts"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          ← Back to list
        </Link>
      </div>

      {msg && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>
      )}

      {/* Details */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">DR Details</div>
        <div className="grid grid-cols-4 gap-x-6 gap-y-4">
          <div className="col-span-2"><Field label="Customer" value={dr.customer_name} /></div>
          <Field label="Delivery Date" value={formatDate(dr.delivery_date)} />
          <Field label="Warehouse" value={dr.warehouse_name} />
          <Field label="Sales Order" value={
            <Link href={`/dashboard/sales/orders/${dr.so_id}`} className="text-brand-700 hover:underline dark:text-brand-400">
              {dr.order_no}
            </Link>
          } />
          <Field label="Payment Terms" value={dr.payment_terms_days ? `${dr.payment_terms_days} days` : null} />
          {dr.tally_sheet_id && (
            <Field label="Source Tally" value={
              <Link href={`/dashboard/sales/tally-sheets/${dr.tally_sheet_id}`} className="text-brand-700 hover:underline dark:text-brand-400">
                View Tally Sheet
              </Link>
            } />
          )}
          {dr.notes && <div className="col-span-4"><Field label="Notes" value={dr.notes} /></div>}
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Delivery Lines
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-8">#</th>
                <th className="px-3 py-2 text-left font-medium w-28">SKU</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-left font-medium w-14">UOM</th>
                <th className="px-3 py-2 text-right font-medium w-24">Qty Delivered</th>
                <th className="px-3 py-2 text-right font-medium w-28">Unit Price</th>
                <th className="px-3 py-2 text-right font-medium w-12">VAT%</th>
              </tr>
            </thead>
            <tbody>
              {dr.lines.map(l => (
                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                  <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400">{l.item_sku ?? '—'}</td>
                  <td className="px-3 py-2 dark:text-slate-300">
                    {l.item_name ?? l.description}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{l.item_uom ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {Number(l.qty_delivered).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">
                    {l.so_unit_price != null ? formatPHP(l.so_unit_price) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right dark:text-slate-300">
                    {l.so_vat_rate != null ? `${l.so_vat_rate}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Total Qty Delivered
                </td>
                <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  {totalQty.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {dr.status === 'draft' && (
          <button onClick={doPost} disabled={busy}
            className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Posting…' : 'Post DR'}
          </button>
        )}
        {dr.status === 'posted' && (
          <button onClick={goCreateSI}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Create Sales Invoice
          </button>
        )}
        <button onClick={() => router.back()}
          className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
          Back
        </button>
      </div>
    </div>
  );
}
