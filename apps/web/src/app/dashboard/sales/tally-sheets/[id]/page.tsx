'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate, formatPHP } from '@/lib/format';

interface TallyLine {
  id: string; line_no: number; item_id: string | null;
  item_sku: string | null; item_name: string | null; description: string;
  qty_allocated: number; allocation_unit: string;
  actual_qty: number; actual_weight_kgs: number;
  unit_price: number; remarks: string | null;
}
interface TallySheet {
  id: string; tally_no: string; tally_date: string;
  delivery_date: string | null; status: string;
  allocation_id: string | null; allocation_no: string | null;
  effective_so_id: string | null; so_no: string | null;
  dr_id: string | null;
  customer_name_live: string; customer_code: string;
  customer_address: string | null; customer_terms: number | null;
  reference: string | null; notes: string | null;
  branch_code: string | null; branch_name: string | null;
  building_code: string | null; building_name: string | null;
  cost_center_code: string | null; cost_center_name: string | null;
  grow_ref_code: string | null;
  lines: TallyLine[];
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100">{value || <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

export default function TallySheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [sheet, setSheet]   = useState<TallySheet | null>(null);
  const [editLines, setEditLines] = useState<TallyLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg]         = useState<string | null>(null);
  const [dirty, setDirty]     = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<TallySheet>(`/sales/tally-sheets/${id}`)
      .then(s => { setSheet(s); setEditLines(s.lines.map(l => ({ ...l }))); })
      .catch(() => { /* silent — don't overwrite save success message */ })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function updateLine(idx: number, field: 'actual_qty' | 'actual_weight_kgs' | 'remarks', val: string | number) {
    setEditLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
    setDirty(true);
  }

  async function save() {
    setSaving(true); setMsg(null);
    try {
      await api.patch(`/sales/tally-sheets/${id}`, { lines: editLines });
      setMsg('✓ Saved successfully');
      setDirty(false);
      load();
    } catch (e: unknown) {
      const msg = (e as Error).message ?? 'Failed to save';
      setMsg(msg.startsWith('{') ? 'Failed to save — check connection' : msg);
    }
    finally { setSaving(false); }
  }

  async function createDR() {
    setCreating(true); setMsg(null);
    try {
      const res = await api.post<{ dr_id: string; dr_no: string }>(`/sales/tally-sheets/${id}/create-dr`);
      setMsg(`✓ Delivery Receipt ${res.dr_no} created.`);
      load();
      router.push(`/dashboard/sales/delivery-receipts/${res.dr_id}`);
    } catch (e: unknown) { setMsg((e as Error).message ?? 'Failed to create DR'); }
    finally { setCreating(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!sheet)  return <div className="py-10 text-center text-sm text-red-600">Tally sheet not found</div>;

  const totalActualQty = editLines.reduce((s, l) => s + Number(l.actual_qty), 0);
  const totalActualKgs = editLines.reduce((s, l) => s + Number(l.actual_weight_kgs), 0);
  const totalAllocated = editLines.reduce((s, l) => s + Number(l.qty_allocated), 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{sheet.tally_no}</h1>
            <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">Sales Tally Sheet</span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{sheet.customer_name_live}</p>
        </div>
        <Link href={sheet.allocation_id ? `/dashboard/sales/allocations/${sheet.allocation_id}` : '/dashboard/sales/allocations'}
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          ← Back to Allocation
        </Link>
      </div>

      {msg && (
        <div className={`rounded border px-3 py-2 text-sm ${msg.startsWith('✓') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg}
        </div>
      )}

      {/* Details */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Tally Sheet Details</div>
        <div className="grid grid-cols-4 gap-x-6 gap-y-4">
          <div className="col-span-2"><Field label="Customer" value={`${sheet.customer_code} — ${sheet.customer_name_live}`} /></div>
          <Field label="Tally Date"    value={formatDate(sheet.tally_date)} />
          <Field label="Delivery Date" value={sheet.delivery_date ? formatDate(sheet.delivery_date) : null} />
          <Field label="Payment Terms" value={sheet.customer_terms != null ? `${sheet.customer_terms} days` : null} />
          <div className="col-span-3"><Field label="Customer Address" value={sheet.customer_address} /></div>
          {sheet.allocation_no && (
            <Field label="Order Allocation" value={
              <Link href={`/dashboard/sales/allocations/${sheet.allocation_id}`} className="text-brand-700 hover:underline dark:text-brand-400">
                {sheet.allocation_no}
              </Link>
            } />
          )}
          {sheet.effective_so_id && (
            <Field label="Sales Order" value={
              <Link href={`/dashboard/sales/orders/${sheet.effective_so_id}`} className="text-brand-700 hover:underline dark:text-brand-400">
                {sheet.so_no ?? sheet.effective_so_id}
              </Link>
            } />
          )}
          {sheet.dr_id && (
            <Field label="Delivery Receipt" value={
              <Link href={`/dashboard/sales/delivery-receipts/${sheet.dr_id}`} className="text-brand-700 hover:underline dark:text-brand-400">
                View DR →
              </Link>
            } />
          )}
          {sheet.reference && <Field label="Reference" value={sheet.reference} />}
          {sheet.notes && <div className="col-span-4"><Field label="Notes" value={sheet.notes} /></div>}
          {(sheet.branch_code || sheet.building_code || sheet.cost_center_code) && (
            <>
              {sheet.branch_code && <Field label="Branch" value={`${sheet.branch_code} — ${sheet.branch_name}`} />}
              {sheet.building_code && <Field label="Building" value={`${sheet.building_code} — ${sheet.building_name}`} />}
              {sheet.cost_center_code && <Field label="Cost Center" value={`${sheet.cost_center_code} — ${sheet.cost_center_name}`} />}
              {sheet.grow_ref_code && <Field label="Grow" value={sheet.grow_ref_code} />}
            </>
          )}
        </div>
      </div>

      {/* Tally Lines — editable actual quantities */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Tally Lines — Record Actual Weights</div>
          {dirty && (
            <button onClick={save} disabled={saving}
              className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Actuals'}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-8">#</th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium w-24">Qty Allocated</th>
                <th className="px-3 py-2 text-left font-medium w-16">Unit</th>
                <th className="px-3 py-2 text-right font-medium w-24 bg-green-50 dark:bg-green-950">Actual Qty</th>
                <th className="px-3 py-2 text-right font-medium w-28 bg-green-50 dark:bg-green-950">Actual Wt (Kgs)</th>
                <th className="px-3 py-2 text-right font-medium w-24">Unit Price</th>
                <th className="px-3 py-2 text-left font-medium">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {editLines.map((l, idx) => (
                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-1.5 text-slate-400">{l.line_no}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-500 dark:text-slate-400">{l.item_sku ?? '—'}</td>
                  <td className="px-3 py-1.5 dark:text-slate-300">{l.description}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-amber-700 dark:text-amber-400">
                    {Number(l.qty_allocated).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-1.5 text-amber-700 dark:text-amber-400 font-medium">{l.allocation_unit}</td>
                  <td className="px-3 py-1.5 bg-green-50/50 dark:bg-green-950/30">
                    <input type="number" min={0} step="any" value={l.actual_qty}
                      onChange={e => updateLine(idx, 'actual_qty', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-0.5 text-right text-xs font-semibold text-green-700 dark:border-slate-600 dark:bg-slate-800 dark:text-green-400" />
                  </td>
                  <td className="px-3 py-1.5 bg-green-50/50 dark:bg-green-950/30">
                    <input type="number" min={0} step="any" value={l.actual_weight_kgs}
                      onChange={e => updateLine(idx, 'actual_weight_kgs', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-0.5 text-right text-xs font-semibold text-green-700 dark:border-slate-600 dark:bg-slate-800 dark:text-green-400" />
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono dark:text-slate-300">{formatPHP(l.unit_price)}</td>
                  <td className="px-3 py-1.5">
                    <input type="text" value={l.remarks ?? ''}
                      onChange={e => updateLine(idx, 'remarks', e.target.value)}
                      placeholder="remarks…"
                      className="w-full rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">Totals</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-amber-700 dark:text-amber-400">
                  {totalAllocated.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
                <td />
                <td className="px-3 py-2 text-right font-mono font-bold text-green-700 dark:text-green-400">
                  {totalActualQty.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2 text-right font-mono font-bold text-green-700 dark:text-green-400">
                  {totalActualKgs.toLocaleString('en-PH', { minimumFractionDigits: 3 })} kgs
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {dirty && (
          <button onClick={save} disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Actuals'}
          </button>
        )}
        {sheet.dr_id ? (
          <Link href={`/dashboard/sales/delivery-receipts/${sheet.dr_id}`}
            className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            View Delivery Receipt
          </Link>
        ) : sheet.effective_so_id ? (
          <button onClick={createDR} disabled={creating || dirty}
            className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            title={dirty ? 'Save actuals first' : 'Create Delivery Receipt from this tally'}>
            {creating ? 'Creating DR…' : 'Create DR'}
          </button>
        ) : null}
        <button
          onClick={() => window.print()}
          className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
          Print
        </button>
      </div>
    </div>
  );
}
