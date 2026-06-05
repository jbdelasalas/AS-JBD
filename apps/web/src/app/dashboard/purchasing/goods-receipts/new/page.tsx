'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, type TaggingValues } from '@/components/TaggingPanel';
import { SearchableSelect } from '@/components/SearchableSelect';

interface POOption { id: string; po_no: string; supplier_name: string; }

interface POLine {
  id: string;
  line_no: number;
  description: string;
  quantity: number;
  qty_received: number;
  unit_price: number;
  item_sku: string | null;
  item_name: string | null;
  branch_id: string | null;
  building_id: string | null;
  cost_center_id: string | null;
  grow_reference_id: string | null;
  branch_code: string | null;
  building_code: string | null;
  cost_center_code: string | null;
  grow_ref_code: string | null;
}

interface PODetail {
  branch_id: string | null;
  building_id: string | null;
  cost_center_id: string | null;
  grow_reference_id: string | null;
  lines: POLine[];
}

interface ReceiptLine {
  po_line_id: string;
  description: string;
  po_qty: number;
  already_received: number;
  qty_received: number;
  unit_cost: number;
  branch_id: string;
  building_id: string;
  cost_center_id: string;
  grow_reference_id: string;
  branch_code: string | null;
  building_code: string | null;
  cost_center_code: string | null;
  grow_ref_code: string | null;
}

function NewGoodsReceiptForm() {
  const router = useRouter();
  const params = useSearchParams();
  const tagData = useTaggingData();

  const [pos, setPos] = useState<POOption[]>([]);
  const [selectedPoId, setSelectedPoId] = useState(params.get('po_id') ?? '');
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingLines, setLoadingLines] = useState(false);

  const [form, setForm] = useState({
    warehouse_id: '',
    receipt_date: new Date().toISOString().split('T')[0],
    delivery_no: '',
    notes: '',
  });
  const [tags, setTags] = useState<TaggingValues>({
    branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '',
  });

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    api.get<{ data: POOption[] }>(`/purchasing/purchase-orders?company_id=${cid}&status=approved&limit=500`)
      .then(r => setPos(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedPoId) { setLines([]); return; }
    setLoadingLines(true);
    api.get<PODetail>(`/purchasing/purchase-orders/${selectedPoId}`)
      .then(po => {
        // Auto-fill header tags from PO
        setTags({
          branch_id:         po.branch_id         ?? '',
          building_id:       po.building_id        ?? '',
          cost_center_id:    po.cost_center_id     ?? '',
          grow_reference_id: po.grow_reference_id  ?? '',
        });

        setLines(po.lines.map(l => ({
          po_line_id:       l.id,
          description:      l.description + (l.item_sku ? ` (${l.item_sku})` : ''),
          po_qty:           l.quantity,
          already_received: l.qty_received,
          qty_received:     Math.max(0, l.quantity - l.qty_received),
          unit_cost:        l.unit_price,
          branch_id:        l.branch_id ?? '',
          building_id:      l.building_id ?? '',
          cost_center_id:   l.cost_center_id ?? '',
          grow_reference_id: l.grow_reference_id ?? '',
          branch_code:      l.branch_code,
          building_code:    l.building_code,
          cost_center_code: l.cost_center_code,
          grow_ref_code:    l.grow_ref_code,
        })));
      })
      .catch(() => {})
      .finally(() => setLoadingLines(false));
  }, [selectedPoId]);

  function handleTagChange(field: keyof TaggingValues, val: string) {
    setTags(t => ({ ...t, [field]: val }));
  }

  function updateQty(idx: number, val: number) {
    setLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], qty_received: val };
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedPoId) { setError('Select a purchase order'); return; }
    if (!lines.some(l => l.qty_received > 0)) { setError('Enter at least one quantity to receive'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const orNull = (v: string) => v || null;
      const grn = await api.post<{ id: string }>('/purchasing/goods-receipts', {
        company_id:   cid,
        po_id:        selectedPoId,
        receipt_date: form.receipt_date,
        warehouse_id: form.warehouse_id || undefined,
        delivery_no:  form.delivery_no  || undefined,
        notes:        form.notes        || undefined,
        branch_id:        orNull(tags.branch_id),
        building_id:      orNull(tags.building_id),
        cost_center_id:   orNull(tags.cost_center_id),
        grow_reference_id: orNull(tags.grow_reference_id),
        lines: lines
          .filter(l => l.qty_received > 0)
          .map(l => ({
            po_line_id:        l.po_line_id,
            qty_received:      l.qty_received,
            unit_cost:         l.unit_cost,
            branch_id:         l.branch_id         || undefined,
            building_id:       l.building_id        || undefined,
            cost_center_id:    l.cost_center_id     || undefined,
            grow_reference_id: l.grow_reference_id  || undefined,
          })),
      });
      router.push(`/dashboard/purchasing/goods-receipts/${grn.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  }

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Goods Receipt</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Record goods received against an approved PO.</p>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Receipt Details */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Receipt Details</div>
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className={lbl}>Purchase Order *</label>
              <SearchableSelect
                required
                value={selectedPoId}
                onChange={setSelectedPoId}
                placeholder="Select approved PO…"
                options={pos.map(p => ({ value: p.id, label: `${p.po_no} — ${p.supplier_name}` }))}
              />
            </div>
            <div>
              <label className={lbl}>Receipt Date *</label>
              <input required type="date" value={form.receipt_date}
                onChange={e => setForm(f => ({ ...f, receipt_date: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Delivery Note / DR No.</label>
              <input type="text" value={form.delivery_no}
                onChange={e => setForm(f => ({ ...f, delivery_no: e.target.value }))} className={inp} />
            </div>
            <div className="col-span-4">
              <label className={lbl}>Notes</label>
              <input type="text" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inp} />
            </div>
            {/* Header tagging — pre-filled from PO, still editable */}
            <TaggingFields value={tags} data={tagData} onChange={handleTagChange} />
          </div>
        </div>

        {/* Lines */}
        {selectedPoId && (
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
              Lines to Receive
            </div>
            {loadingLines ? (
              <div className="py-8 text-center text-xs text-slate-500">Loading PO lines…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Description</th>
                      <th className="px-3 py-2 text-right font-medium w-20">PO Qty</th>
                      <th className="px-3 py-2 text-right font-medium w-20">Rcvd</th>
                      <th className="px-3 py-2 text-right font-medium w-28">Receiving *</th>
                      <th className="px-3 py-2 text-left font-medium w-20">Location</th>
                      <th className="px-3 py-2 text-left font-medium w-20">Building</th>
                      <th className="px-3 py-2 text-left font-medium w-24">Cost Center</th>
                      <th className="px-3 py-2 text-left font-medium w-20">Grow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={l.po_line_id} className="border-b border-slate-100 dark:border-slate-700">
                        <td className="px-3 py-1.5 dark:text-slate-300">{l.description}</td>
                        <td className="px-3 py-1.5 text-right font-mono dark:text-slate-300">{l.po_qty}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-500 dark:text-slate-400">{l.already_received}</td>
                        <td className="px-2 py-1">
                          <input
                            type="number" min={0} step="any"
                            max={l.po_qty - l.already_received}
                            value={l.qty_received}
                            onChange={e => updateQty(idx, parseFloat(e.target.value) || 0)}
                            className="w-full rounded border border-slate-300 px-1 py-1 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{l.branch_code ?? '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{l.building_code ?? '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{l.cost_center_code ?? '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{l.grow_ref_code ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Receipt'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewGoodsReceiptPage() {
  return <Suspense><NewGoodsReceiptForm /></Suspense>;
}
