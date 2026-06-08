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
  tally_doc_no: string | null;
  je_id: string | null;
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
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editWarehouseId, setEditWarehouseId] = useState('');
  const [editLines, setEditLines] = useState<Array<{ id: string; item_id: string; item_name: string | null; item_sku: string | null; item_uom: string | null; so_line_id: string | null; qty_delivered: number; unit_cost: number; so_unit_price: number | null }>>([]);
  const [editLocations, setEditLocations] = useState<Array<{ id: string; code: string; name: string; warehouse_id: string | null; warehouse_name: string | null }>>([]);
  const [editTallyNo, setEditTallyNo] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get<DR>(`/sales/delivery-receipts/${id}`).then(setDr).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    if (!window.confirm('Delete this delivery receipt? This cannot be undone.')) return;
    setBusy(true); setMsg(null);
    try {
      await api.delete(`/sales/delivery-receipts/${id}`);
      router.push('/dashboard/sales/delivery-receipts');
    } catch (e: unknown) { setMsg((e as Error).message ?? 'Delete failed'); setBusy(false); }
  }

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

  function startEdit() {
    if (!dr) return;
    setEditDate(dr.delivery_date?.split('T')[0] ?? '');
    setEditNotes(dr.notes ?? '');
    setEditTallyNo('');
    setEditWarehouseId((dr as unknown as Record<string, unknown>).warehouse_id as string ?? '');
    setEditLines(dr.lines.map(l => ({
      id: l.id, item_id: l.item_id, item_name: l.item_name, item_sku: l.item_sku, item_uom: l.item_uom,
      so_line_id: (l as unknown as Record<string, unknown>).so_line_id as string | null ?? null,
      qty_delivered: l.qty_delivered, unit_cost: l.unit_cost, so_unit_price: l.so_unit_price,
    })));
    const cid = localStorage.getItem('company_id') ?? '';
    api.get<Array<{ id: string; code: string; name: string; warehouse_id: string | null; warehouse_name: string | null }>>(
      `/inventory/locations?company_id=${cid}`
    ).then(locs => setEditLocations(locs.filter(l => l.warehouse_id))).catch(() => {});
    setEditing(true);
    setMsg(null);
  }

  async function saveEdit() {
    if (!dr) return;
    setBusy(true); setMsg(null);
    try {
      await api.patch(`/sales/delivery-receipts/${id}`, {
        delivery_date: editDate || undefined,
        warehouse_id: editWarehouseId || undefined,
        notes: editNotes || null,
        ...(editTallyNo.trim() ? { tally_sheet_no: editTallyNo.trim() } : {}),
        lines: editLines.map(l => ({
          item_id: l.item_id,
          so_line_id: l.so_line_id,
          qty_delivered: Number(l.qty_delivered),
          unit_cost: l.unit_cost,
          description: l.item_name ?? '',
        })),
      });
      setEditing(false);
      load();
    } catch (e: unknown) {
      setMsg((e as Error).message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
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
        <div className="flex items-center gap-3">
          <Link href={`/print/dr/${id}`} target="_blank"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            🖨 Print
          </Link>
          <Link href="/dashboard/sales/delivery-receipts"
            className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            ← Back to list
          </Link>
        </div>
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
          <div>
            <div className="mb-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">Tally Sheet</div>
            {dr.tally_sheet_id
              ? <div className="text-sm"><Link href={`/dashboard/poultry/tally-sheets/${dr.tally_sheet_id}`} className="text-brand-700 hover:underline dark:text-brand-400">{dr.tally_doc_no ?? 'View Tally Sheet'}</Link></div>
              : <form className="flex gap-1.5" onSubmit={async e => {
                  e.preventDefault();
                  const input = (e.currentTarget.elements.namedItem('tsno') as HTMLInputElement).value.trim();
                  if (!input) return;
                  setBusy(true); setMsg(null);
                  try {
                    await api.patch(`/sales/delivery-receipts/${id}`, { tally_sheet_no: input });
                    load();
                  } catch (err: unknown) { setMsg((err as Error).message ?? 'Failed'); }
                  finally { setBusy(false); }
                }}>
                  <input name="tsno" type="text" placeholder="TS-2026-XXXXXX"
                    className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 w-36" />
                  <button type="submit" disabled={busy}
                    className="rounded border border-brand-300 bg-brand-50 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100 disabled:opacity-50">
                    Link
                  </button>
                </form>
            }
          </div>
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

      {/* Edit form (shown when editing) */}
      {editing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/30 space-y-4">
          <div className="text-sm font-medium text-amber-800 dark:text-amber-300">Edit Delivery Receipt</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Delivery Date</label>
              <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Warehouse</label>
              <select value={editWarehouseId} onChange={e => setEditWarehouseId(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">— select —</option>
                {editLocations.map(l => (
                  <option key={l.warehouse_id!} value={l.warehouse_id!}>{l.code} — {l.warehouse_name ?? l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Notes</label>
              <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Link Tally Sheet <span className="font-normal text-slate-400">(current: {dr.tally_sheet_id ? 'linked' : 'none'})</span>
              </label>
              <input type="text" value={editTallyNo} onChange={e => setEditTallyNo(e.target.value)}
                placeholder="e.g. TS-2026-000005"
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 placeholder:text-slate-400" />
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Lines — Qty Delivered</div>
            <div className="space-y-1">
              {editLines.map((l, i) => (
                <div key={l.id} className="flex items-center gap-3 text-sm">
                  <span className="w-6 text-right text-xs text-slate-400">{i + 1}</span>
                  <span className="font-mono text-xs text-slate-500 w-24">{l.item_sku ?? '—'}</span>
                  <span className="flex-1 dark:text-slate-300">{l.item_name ?? '—'}</span>
                  <span className="text-xs text-slate-400 w-10">{l.item_uom ?? ''}</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={l.qty_delivered}
                    onChange={e => {
                      const updated = [...editLines];
                      updated[i] = { ...updated[i], qty_delivered: Number(e.target.value) };
                      setEditLines(updated);
                    }}
                    className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm font-mono dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                  {l.so_unit_price != null && (
                    <span className="text-xs text-slate-400 w-28 text-right font-mono">
                      {formatPHP(l.so_unit_price)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          {dr.status === 'draft' && !editing && (
            <>
              <button onClick={startEdit} disabled={busy}
                className="rounded bg-amber-500 px-5 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                Edit
              </button>
              <button onClick={doPost} disabled={busy}
                className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy ? 'Posting…' : 'Post DR'}
              </button>
            </>
          )}
          {editing && (
            <>
              <button onClick={saveEdit} disabled={busy}
                className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save Changes'}
              </button>
              <button onClick={() => { setEditing(false); setMsg(null); }} disabled={busy}
                className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50">
                Cancel
              </button>
            </>
          )}
          {dr.status === 'posted' && (
            <>
              <button onClick={goCreateSI}
                className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Create Sales Invoice
              </button>
              {dr.je_id && (
                <Link href={`/dashboard/gl/journal-entries/${dr.je_id}`}
                  className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                  View Journal Entry
                </Link>
              )}
            </>
          )}
          {!editing && (
            <>
              <Link href={`/print/dr/${id}`} target="_blank"
                className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Print
              </Link>
              <button onClick={() => router.back()}
                className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Back
              </button>
            </>
          )}
        </div>
        {dr.status === 'draft' && !editing && (
          <button onClick={handleDelete} disabled={busy}
            className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-950 dark:text-red-400">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
