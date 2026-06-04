'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate, formatPHP } from '@/lib/format';

interface AllocLine {
  id: string; line_no: number; item_id: string | null;
  item_sku: string | null; item_name: string | null; item_uom: string | null; description: string;
  qty_ordered: number; qty_allocated: number; allocation_unit: string;
  unit_price: number; discount_pct: number; vat_rate: number;
  branch_code: string | null; building_code: string | null;
  cost_center_code: string | null; grow_ref_code: string | null;
}
interface Allocation {
  id: string; allocation_no: string; allocation_date: string;
  delivery_date: string | null; status: string; reference: string | null;
  notes: string | null; with_si: boolean; so_no: string | null; so_id: string | null;
  customer_name_live: string; customer_code: string;
  customer_address: string | null; customer_terms: number | null;
  tally_sheet_id: string | null;
  branch_code: string | null; branch_name: string | null;
  building_code: string | null; building_name: string | null;
  cost_center_code: string | null; cost_center_name: string | null;
  grow_ref_code: string | null; grow_ref_name: string | null;
  lines: AllocLine[];
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  posted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100">{value || <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

export default function AllocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [alloc, setAlloc]   = useState<Allocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Allocation>(`/sales/allocations/${id}`).then(setAlloc).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function doPost() {
    setBusy(true); setMsg(null);
    try {
      const res = await api.post<{ tally_sheet_id: string; tally_no: string }>(`/sales/allocations/${id}/post`);
      setMsg(`✓ Posted — Sales Tally Sheet ${res.tally_no} created.`);
      load();
    } catch (e: unknown) { setMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!alloc)  return <div className="py-10 text-center text-sm text-red-600">Allocation not found</div>;

  const totalAllocated = alloc.lines.reduce((s, l) => s + Number(l.qty_allocated), 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{alloc.allocation_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[alloc.status] ?? STATUS_STYLES.draft}`}>
              {alloc.status}
            </span>
            {alloc.with_si && <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">With SI</span>}
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{alloc.customer_name_live}</p>
        </div>
        <Link href="/dashboard/sales/allocations" className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          ← Back to list
        </Link>
      </div>

      {msg && (
        <div className={`rounded border px-3 py-2 text-sm ${msg.startsWith('✓') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg}
          {alloc.tally_sheet_id && msg.startsWith('✓') && (
            <Link href={`/dashboard/sales/tally-sheets/${alloc.tally_sheet_id}`} className="ml-3 underline font-medium">
              Open Tally Sheet →
            </Link>
          )}
        </div>
      )}

      {/* Details card */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Allocation Details</div>
        <div className="grid grid-cols-4 gap-x-6 gap-y-4">
          <div className="col-span-2"><Field label="Customer" value={`${alloc.customer_code} — ${alloc.customer_name_live}`} /></div>
          <Field label="Allocation Date" value={formatDate(alloc.allocation_date)} />
          <Field label="Delivery Date"   value={alloc.delivery_date ? formatDate(alloc.delivery_date) : null} />
          <Field label="Payment Terms"   value={alloc.customer_terms != null ? `${alloc.customer_terms} days` : null} />
          <div className="col-span-3"><Field label="Customer Address" value={alloc.customer_address} /></div>
          <Field label="SO Reference" value={alloc.so_id
            ? <Link href={`/dashboard/sales/orders/${alloc.so_id}`} className="text-brand-700 hover:underline dark:text-brand-400">{alloc.so_no}</Link>
            : null} />
          <Field label="Reference" value={alloc.reference} />
          <Field label="With SI" value={alloc.with_si ? '✓ Yes' : 'No'} />
          {alloc.tally_sheet_id && (
            <Field label="Tally Sheet" value={
              <Link href={`/dashboard/sales/tally-sheets/${alloc.tally_sheet_id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                View Sales Tally Sheet →
              </Link>
            } />
          )}
          {alloc.notes && <div className="col-span-4"><Field label="Notes" value={alloc.notes} /></div>}
          {(alloc.branch_code || alloc.building_code || alloc.cost_center_code || alloc.grow_ref_code) && (
            <>
              {alloc.branch_code && <Field label="Branch" value={`${alloc.branch_code} — ${alloc.branch_name}`} />}
              {alloc.building_code && <Field label="Building" value={`${alloc.building_code} — ${alloc.building_name}`} />}
              {alloc.cost_center_code && <Field label="Cost Center" value={`${alloc.cost_center_code} — ${alloc.cost_center_name}`} />}
              {alloc.grow_ref_code && <Field label="Grow" value={`${alloc.grow_ref_code} — ${alloc.grow_ref_name}`} />}
            </>
          )}
        </div>
      </div>

      {/* Allocation Lines */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Allocation Lines
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-8">#</th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium w-14">UOM</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium w-24">Qty Ordered</th>
                <th className="px-3 py-2 text-right font-medium w-24 bg-amber-50 dark:bg-amber-950">Qty Allocated</th>
                <th className="px-3 py-2 text-left font-medium w-16 bg-amber-50 dark:bg-amber-950">Unit</th>
                <th className="px-3 py-2 text-right font-medium w-24">Unit Price</th>
                <th className="px-3 py-2 text-right font-medium w-12">Disc%</th>
                <th className="px-3 py-2 text-right font-medium w-12">VAT%</th>
                <th className="px-3 py-2 text-left font-medium w-16">Location</th>
                <th className="px-3 py-2 text-left font-medium w-16">Building</th>
                <th className="px-3 py-2 text-left font-medium w-20">Cost Ctr</th>
                <th className="px-3 py-2 text-left font-medium w-16">Grow</th>
              </tr>
            </thead>
            <tbody>
              {alloc.lines.map(l => (
                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                  <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400">{l.item_sku ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.item_uom ?? '—'}</td>
                  <td className="px-3 py-2 dark:text-slate-300">
                    {l.description}
                    {l.item_name && <span className="ml-1 text-slate-400">({l.item_name})</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{Number(l.qty_ordered).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/30">
                    {Number(l.qty_allocated).toLocaleString('en-PH', {minimumFractionDigits: 2})}
                  </td>
                  <td className="px-3 py-2 font-medium text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/30">{l.allocation_unit}</td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(l.unit_price)}</td>
                  <td className="px-3 py-2 text-right dark:text-slate-300">{l.discount_pct}%</td>
                  <td className="px-3 py-2 text-right dark:text-slate-300">{l.vat_rate}%</td>
                  <td className="px-3 py-2 text-slate-500">{l.branch_code ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{l.building_code ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{l.cost_center_code ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{l.grow_ref_code ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">Total Allocated</td>
                <td />
                <td className="px-3 py-2 text-right font-mono font-bold text-amber-700 dark:text-amber-400">
                  {totalAllocated.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
                <td colSpan={8} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        {alloc.status === 'draft' && (
          <button onClick={doPost} disabled={busy}
            className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Posting…' : 'Post Allocation — Create Tally Sheet'}
          </button>
        )}
        {alloc.tally_sheet_id && (
          <Link href={`/dashboard/sales/tally-sheets/${alloc.tally_sheet_id}`}
            className="rounded bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Open Tally Sheet
          </Link>
        )}
      </div>
    </div>
  );
}
