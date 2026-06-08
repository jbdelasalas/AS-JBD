'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { SearchableSelect } from '@/components/SearchableSelect';
import { NumericInput } from '@/components/NumericInput';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, GrowSelect, type TaggingValues } from '@/components/TaggingPanel';

interface Supplier { id: string; code: string; name: string; payment_terms_days: number; }
interface Account { id: string; code: string; name: string; }
interface BillOption { id: string; internal_no: string; bill_no: string; }

interface Line {
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  expense_account_id: string;
  branch_id: string;
  building_id: string;
  cost_center_id: string;
  grow_reference_id: string;
}

const EMPTY_LINE: Line = {
  description: '', quantity: 1, unit_price: 0, vat_rate: 12,
  expense_account_id: '', branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '',
};

function NewCreditMemoForm() {
  const router = useRouter();
  const params = useSearchParams();
  const tagData = useTaggingData();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts]   = useState<Account[]>([]);
  const [bills, setBills]         = useState<BillOption[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [form, setForm] = useState({
    supplier_id: '',
    memo_date: new Date().toISOString().split('T')[0],
    bill_id: params.get('bill_id') ?? '',
    reason: '',
    notes: '',
  });
  const [tags, setTags] = useState<TaggingValues>({ branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '' });
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    Promise.all([
      api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${cid}&limit=500`),
      api.get<Account[]>(`/gl/accounts?company_id=${cid}&limit=500`),
      api.get<{ data: BillOption[] }>(`/ap/bills?company_id=${cid}&limit=500`),
    ]).then(([s, a, b]) => {
      setSuppliers(s.data);
      setAccounts(Array.isArray(a) ? a : []);
      setBills(b.data);
    }).catch(() => {});
  }, []);

  function handleTagChange(field: keyof TaggingValues, val: string) {
    setTags(t => ({ ...t, [field]: val }));
    setLines(prev => prev.map(l => ({ ...l, [field]: val })));
  }

  function addLine() {
    setLines(l => [...l, { ...EMPTY_LINE, branch_id: tags.branch_id, building_id: tags.building_id, cost_center_id: tags.cost_center_id, grow_reference_id: tags.grow_reference_id }]);
  }

  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines(prev => { const next = [...prev]; next[idx] = { ...next[idx], [field]: val }; return next; });
  }

  function lineSubtotal(l: Line) { return l.quantity * l.unit_price; }
  function lineVat(l: Line)      { return lineSubtotal(l) * (l.vat_rate / 100); }
  function lineTotal(l: Line)    { return lineSubtotal(l) + lineVat(l); }

  const totalSubtotal = lines.reduce((s, l) => s + lineSubtotal(l), 0);
  const totalVat      = lines.reduce((s, l) => s + lineVat(l), 0);
  const grandTotal    = lines.reduce((s, l) => s + lineTotal(l), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.supplier_id) { setError('Select a supplier'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const cm = await api.post<{ id: string }>('/ap/credit-memos', {
        company_id: cid,
        supplier_id: form.supplier_id,
        memo_date: form.memo_date,
        bill_id: form.bill_id || undefined,
        reason: form.reason || undefined,
        notes: form.notes || undefined,
        ...tags,
        lines: lines.map(l => ({
          ...l,
          expense_account_id: l.expense_account_id || undefined,
        })),
      });
      router.push(`/dashboard/ap/credit-memos/${cm.id}`);
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed'); } finally { setSaving(false); }
  }

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';
  const cellSel = 'w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Bill Credit Memo</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Record a supplier credit note to reduce AP balance.</p>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Header */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Credit Memo Details</div>
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className={lbl}>Supplier *</label>
              <SearchableSelect required value={form.supplier_id}
                onChange={v => setForm(f => ({ ...f, supplier_id: v }))}
                placeholder="Select supplier…"
                options={suppliers.map(s => ({ value: s.id, label: `${s.code} — ${s.name}` }))}
              />
            </div>
            <div>
              <label className={lbl}>Memo Date *</label>
              <input required type="date" value={form.memo_date} onChange={e => setForm(f => ({ ...f, memo_date: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Linked Bill</label>
              <select value={form.bill_id} onChange={e => setForm(f => ({ ...f, bill_id: e.target.value }))} className={inp}>
                <option value="">— none —</option>
                {bills.map(b => <option key={b.id} value={b.id}>{b.internal_no} ({b.bill_no})</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={lbl}>Reason</label>
              <input type="text" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Returned goods, price adjustment…" className={inp} />
            </div>
            <div className="col-span-2">
              <label className={lbl}>Notes</label>
              <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inp} />
            </div>
            <TaggingFields value={tags} data={tagData} onChange={handleTagChange} />
          </div>
        </div>

        {/* Lines */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Line Items</div>
            <button type="button" onClick={addLine} className="text-xs text-brand-600 hover:underline dark:text-brand-400">+ Add line</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium w-48">Account</th>
                  <th className="px-2 py-1.5 text-left font-medium">Description *</th>
                  <th className="px-2 py-1.5 text-right font-medium w-16">Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium w-28">Unit Price</th>
                  <th className="px-2 py-1.5 text-right font-medium w-14">VAT %</th>
                  <th className="px-2 py-1.5 text-right font-medium w-28">Subtotal</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24">VAT</th>
                  <th className="px-2 py-1.5 text-right font-medium w-28">Total</th>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Location</th>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Building</th>
                  <th className="px-2 py-1.5 text-left font-medium w-24">Cost Center</th>
                  <th className="px-2 py-1.5 text-left font-medium w-28">Grow</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-1">
                      <select value={l.expense_account_id} onChange={e => updateLine(idx, 'expense_account_id', e.target.value)} className={cellSel}>
                        <option value="">Select account…</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input required type="text" value={l.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <NumericInput value={l.quantity} onChange={v => updateLine(idx, 'quantity', v)} min={0} decimals={4}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <NumericInput value={l.unit_price} onChange={v => updateLine(idx, 'unit_price', v)} min={0} decimals={4}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1">
                      <NumericInput value={l.vat_rate} onChange={v => updateLine(idx, 'vat_rate', v)} min={0} decimals={2}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </td>
                    <td className="px-2 py-1 text-right font-mono dark:text-slate-300">
                      {lineSubtotal(l).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1 text-right font-mono dark:text-slate-300">
                      {lineVat(l).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1 text-right font-mono font-semibold dark:text-slate-300">
                      {lineTotal(l).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.branch_id} onChange={e => updateLine(idx, 'branch_id', e.target.value)} className={cellSel}>
                        <option value="">—</option>
                        {tagData.branches.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.building_id} onChange={e => updateLine(idx, 'building_id', e.target.value)} className={cellSel}>
                        <option value="">—</option>
                        {tagData.buildings.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.cost_center_id} onChange={e => updateLine(idx, 'cost_center_id', e.target.value)} className={cellSel}>
                        <option value="">—</option>
                        {tagData.costCenters.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <GrowSelect value={l.grow_reference_id} data={tagData} onChange={v => updateLine(idx, 'grow_reference_id', v)} />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines(ls => ls.filter((_, i) => i !== idx))}
                          className="text-red-500 hover:text-red-700">×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <td colSpan={5} className="px-2 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">Subtotal</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-slate-700 dark:text-slate-300">{totalSubtotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-slate-700 dark:text-slate-300">{totalVat.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td colSpan={6} />
                </tr>
                <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <td colSpan={7} className="px-2 py-2 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">Total Credit Memo</td>
                  <td className="px-2 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                    ₱{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save as Draft'}
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

export default function NewCreditMemoPage() { return <Suspense><NewCreditMemoForm /></Suspense>; }
