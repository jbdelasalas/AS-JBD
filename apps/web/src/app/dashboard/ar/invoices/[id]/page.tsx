'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { SalesInvoice } from '@perpet/shared';
import JournalPreviewModal from '@/components/JournalPreviewModal';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, GrowSelect, type TaggingValues } from '@/components/TaggingPanel';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:text-slate-300',
  open: 'bg-blue-100 text-blue-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500 dark:text-slate-400',
};

interface Payment {
  id: string; receipt_no: string; payment_date: string;
  payment_method: string; amount: number; amount_applied: number; status: string;
}
interface Customer { id: string; code: string; name: string; payment_terms_days: number; }
interface Item { id: string; sku: string; name: string; selling_price: number; uom: string; }

interface EditLine {
  line_type: 'item' | 'gl';
  item_id: string;
  gl_account_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  vat_rate: number;
  uom: string;
  grow_reference_id: string;
}

const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

function lineTotal(l: EditLine) {
  const sub = l.quantity * l.unit_price * (1 - l.discount_pct / 100);
  return sub + sub * (l.vat_rate / 100);
}

function DraftEditForm({ inv, onSaved, onPost }: { inv: SalesInvoice; onSaved: () => void; onPost: () => void }) {
  const tagData = useTaggingData();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJEPreview, setShowJEPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  const invAny = inv as unknown as Record<string, unknown>;

  const [form, setForm] = useState({
    customer_id: inv.customer_id,
    invoice_date: inv.invoice_date?.split('T')[0] ?? '',
    payment_terms_days: inv.payment_terms_days ?? 30,
    reference: (invAny.reference as string) ?? '',
    notes: (invAny.notes as string) ?? '',
  });
  const [tags, setTags] = useState<TaggingValues>({
    branch_id:         (invAny.branch_id as string)         ?? '',
    building_id:       (invAny.building_id as string)       ?? '',
    cost_center_id:    (invAny.cost_center_id as string)    ?? '',
    grow_reference_id: (invAny.grow_reference_id as string) ?? '',
  });
  const [lines, setLines] = useState<EditLine[]>(
    (inv.lines ?? []).map(l => ({
      line_type: 'item' as const,
      item_id:        (l as unknown as Record<string,unknown>).item_id as string ?? '',
      gl_account_id:  '',
      description:    l.description,
      quantity:       l.quantity,
      unit_price:     l.unit_price,
      discount_pct:   l.discount_pct ?? 0,
      vat_rate:       l.vat_rate,
      uom:            (l as unknown as Record<string,unknown>).item_uom as string ?? '',
      grow_reference_id: (l as unknown as Record<string,unknown>).grow_reference_id as string ?? '',
    }))
  );

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    Promise.all([
      api.get<{ data: Customer[] }>(`/ar/customers?company_id=${cid}&is_active=true&limit=200`),
      api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=200`),
    ]).then(([c, i]) => { setCustomers(c.data); setItems(i); }).catch(() => {});
  }, []);

  function handleTagChange(field: keyof TaggingValues, val: string) {
    setTags(t => ({ ...t, [field]: val }));
    if (field === 'grow_reference_id') setLines(prev => prev.map(l => ({ ...l, grow_reference_id: val })));
  }

  function updateLine(idx: number, field: keyof EditLine, val: string | number) {
    setLines(prev => {
      const next = [...prev];
      const line = { ...next[idx] };
      if (field === 'item_id' && typeof val === 'string') {
        const item = items.find(i => i.id === val);
        line.item_id = val;
        if (item) { line.description = item.name; line.unit_price = item.selling_price; line.uom = item.uom; }
      } else {
        (line as Record<string, unknown>)[field] = val;
      }
      next[idx] = line;
      return next;
    });
  }

  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSaving(true);
    try {
      await api.patch(`/ar/invoices/${inv.id}`, {
        ...form,
        branch_id:         tags.branch_id         || undefined,
        building_id:       tags.building_id       || undefined,
        cost_center_id:    tags.cost_center_id    || undefined,
        grow_reference_id: tags.grow_reference_id || undefined,
        lines: lines.map(l => ({ ...l, item_id: l.item_id || undefined })),
      });
      onSaved();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Save failed');
    } finally { setSaving(false); }
  }

  async function doPost() {
    setBusy(true);
    try { await api.post(`/ar/invoices/${inv.id}/post`); onPost(); }
    catch (e: unknown) { setError((e as Error).message ?? 'Post failed'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{inv.invoice_no}</h1>
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES.draft}`}>draft</span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowJEPreview(true)} disabled={busy || saving}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
            Post Invoice
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <form onSubmit={handleSave} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Invoice Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Customer *</label>
              <select required value={form.customer_id}
                onChange={e => { const c = customers.find(x => x.id === e.target.value); setForm(f => ({ ...f, customer_id: e.target.value, payment_terms_days: c?.payment_terms_days ?? f.payment_terms_days })); }}
                className={inp}>
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Invoice Date *</label>
              <input required type="date" value={form.invoice_date}
                onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Payment Terms (days)</label>
              <input type="number" min={0} value={form.payment_terms_days}
                onChange={e => setForm(f => ({ ...f, payment_terms_days: parseInt(e.target.value) }))} className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Reference</label>
              <input type="text" value={form.reference}
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className={inp} />
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
              <textarea rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inp} />
            </div>
            <TaggingFields value={tags} data={tagData} onChange={handleTagChange} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Line Items</div>
            <button type="button"
              onClick={() => setLines(l => [...l, { line_type: 'item', item_id: '', gl_account_id: '', description: '', quantity: 1, unit_price: 0, discount_pct: 0, vat_rate: 12, uom: '', grow_reference_id: tags.grow_reference_id }])}
              className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="w-40 px-2 py-1.5 text-left font-medium">Item</th>
                <th className="px-2 py-1.5 text-left font-medium">Description *</th>
                <th className="w-16 px-2 py-1.5 text-right font-medium">Qty</th>
                <th className="w-14 px-2 py-1.5 text-left font-medium">UOM</th>
                <th className="w-24 px-2 py-1.5 text-right font-medium">Unit Price</th>
                <th className="w-14 px-2 py-1.5 text-right font-medium">Disc %</th>
                <th className="w-14 px-2 py-1.5 text-right font-medium">VAT %</th>
                <th className="w-24 px-2 py-1.5 text-right font-medium">Total</th>
                <th className="w-28 px-2 py-1.5 text-left font-medium">Grow</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-2 py-1">
                    <select value={l.item_id} onChange={e => updateLine(idx, 'item_id', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="">— none —</option>
                      {items.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input required type="text" value={l.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                      className="w-full rounded border border-slate-300 px-1 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0.0001} step="any" value={l.quantity} onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1 text-slate-500 dark:text-slate-400">{l.uom || '—'}</td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} step="any" value={l.unit_price} onChange={e => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} max={100} step="any" value={l.discount_pct} onChange={e => updateLine(idx, 'discount_pct', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} step="any" value={l.vat_rate} onChange={e => updateLine(idx, 'vat_rate', parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-300 px-1 py-1 text-right" />
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    {lineTotal(l).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-2 py-1">
                    <GrowSelect value={l.grow_reference_id} data={tagData} onChange={v => updateLine(idx, 'grow_reference_id', v)} />
                  </td>
                  <td className="px-1 py-1 text-center">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines(l => l.filter((_, i) => i !== idx))}
                        className="text-red-500 hover:text-red-700">×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <td colSpan={8} className="px-2 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Grand Total (incl. VAT)</td>
                <td className="px-2 py-2 text-right font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                  ₱{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
        </div>
      </form>

      {showJEPreview && (
        <JournalPreviewModal
          previewUrl={`/ar/invoices/${inv.id}/journal-preview`}
          confirmLabel="Confirm Post Invoice"
          busy={busy}
          onConfirm={async () => { await doPost(); setShowJEPreview(false); }}
          onCancel={() => setShowJEPreview(false)}
        />
      )}
    </div>
  );
}

export default function SalesInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inv, setInv] = useState<SalesInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [showJEPreview, setShowJEPreview] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') ?? '' : '';

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<SalesInvoice>(`/ar/invoices/${id}`),
      api.get<{ data: Payment[] }>(`/ar/collections?company_id=${companyId}&invoice_id=${id}`),
    ]).then(([inv, pay]) => { setInv(inv); setPayments(pay.data); })
      .finally(() => setLoading(false));
  }, [id, companyId]);

  useEffect(() => { load(); }, [load]);

  async function doPost() {
    setBusy(true); setActionMsg(null);
    try { await api.post(`/ar/invoices/${id}/post`); load(); }
    catch (e: unknown) { setActionMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  async function doVoid() {
    setBusy(true); setActionMsg(null);
    try { await api.post(`/ar/invoices/${id}/void`, { reason: voidReason }); setShowVoid(false); load(); }
    catch (e: unknown) { setActionMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  if (!inv) return <div className="py-10 text-center text-sm text-red-600">Invoice not found</div>;

  // Draft → show editable form
  if (inv.status === 'draft') {
    return <DraftEditForm inv={inv} onSaved={load} onPost={() => { load(); router.refresh(); }} />;
  }

  const paidPct = inv.total > 0 ? Math.min((inv.amount_paid / inv.total) * 100, 100) : 0;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{inv.invoice_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[inv.status] ?? STATUS_STYLES.draft}`}>
              {inv.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{inv.customer_name}</p>
        </div>
        <div className="flex gap-2">
          {(inv as unknown as { je_id?: string }).je_id && (
            <Link href={`/dashboard/gl/journal-entries/${(inv as unknown as { je_id?: string }).je_id}`}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              View Journal Entry
            </Link>
          )}
          {['open','overdue','partially_paid'].includes(inv.status) && (
            <Link href={`/dashboard/ar/collections/new?invoice_id=${id}&customer_id=${inv.customer_id}`}
              className="rounded border border-brand-600 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50">
              Record Payment
            </Link>
          )}
          {['draft','open'].includes(inv.status) && inv.amount_paid === 0 && (
            <button onClick={() => setShowVoid(true)} disabled={busy}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
              Void
            </button>
          )}
        </div>
      </div>

      {actionMsg && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionMsg}</div>}

      {inv.status !== 'cancelled' && (
        <div className="mb-5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="mb-1 flex justify-between text-xs text-slate-600 dark:text-slate-400">
            <span>Payment Progress</span><span>{paidPct.toFixed(1)}% paid</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100">
            <div className={`h-2 rounded-full transition-all ${paidPct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${paidPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Paid: {formatPHP(inv.amount_paid)}</span>
            <span>Balance: {formatPHP(inv.balance)}</span>
          </div>
        </div>
      )}

      <div className="mb-3 grid grid-cols-4 gap-3">
        {[
          { label: 'Invoice Date', value: formatDate(inv.invoice_date) },
          { label: 'Due Date', value: formatDate(inv.due_date) },
          { label: 'Payment Terms', value: `${inv.payment_terms_days} days` },
          { label: 'SO Reference', value: inv.order_no ?? '—' },
        ].map(f => (
          <div key={f.label} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">{f.label}</div>
            <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{f.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white">
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300">Invoice Lines</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-left font-medium">UOM</th>
              <th className="px-3 py-2 text-right font-medium">Unit Price</th>
              <th className="px-3 py-2 text-right font-medium">Disc %</th>
              <th className="px-3 py-2 text-right font-medium">VAT %</th>
              <th className="px-3 py-2 text-right font-medium">Subtotal</th>
              <th className="px-3 py-2 text-right font-medium">VAT</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines?.map(l => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2">{l.description}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{l.quantity}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.item_uom ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(l.unit_price)}</td>
                <td className="px-3 py-2 text-right text-xs">{l.discount_pct}%</td>
                <td className="px-3 py-2 text-right text-xs">{l.vat_rate}%</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(l.line_subtotal)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatPHP(l.line_vat)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{formatPHP(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {[{ label: 'Subtotal', value: inv.subtotal }, { label: 'VAT (12%)', value: inv.vat_amount }].map(row => (
              <tr key={row.label} className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={9} className="px-3 py-1.5 text-right text-xs text-slate-600 dark:text-slate-400">{row.label}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{formatPHP(row.value)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <td colSpan={9} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total</td>
              <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(inv.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300">Payments Applied</div>
        {payments.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-400">No payments recorded yet.</div>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Receipt No.</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Method</th>
                <th className="px-3 py-2 text-right font-medium">Applied</th>
                <th className="px-3 py-2 text-right font-medium">Total Payment</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/ar/collections/${p.id}`} className="text-brand-700 hover:underline dark:text-brand-400">{p.receipt_no}</Link>
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
          previewUrl={`/ar/invoices/${id}/journal-preview`}
          confirmLabel="Confirm Post Invoice"
          busy={busy}
          onConfirm={async () => { await doPost(); setShowJEPreview(false); }}
          onCancel={() => setShowJEPreview(false)}
        />
      )}

      {showVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Void Invoice</h2>
            <textarea rows={3} placeholder="Reason for voiding (required)…"
              value={voidReason} onChange={e => setVoidReason(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            <div className="flex gap-2">
              <button disabled={!voidReason.trim() || busy} onClick={doVoid}
                className="flex-1 rounded bg-red-600 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-40">
                Confirm Void
              </button>
              <button onClick={() => setShowVoid(false)} className="flex-1 rounded border border-slate-300 py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
