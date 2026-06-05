'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { SearchableSelect } from '@/components/SearchableSelect';
import { NumericInput } from '@/components/NumericInput';
import { useTaggingData } from '@/hooks/useTaggingData';
import { TaggingFields, GrowSelect, type TaggingValues } from '@/components/TaggingPanel';

interface Supplier { id: string; code: string; name: string; payment_terms_days: number; ewt_rate: number; }
interface Account { id: string; code: string; name: string; }
interface POOption { id: string; po_no: string; }
interface TaxCode { id: string; code: string; name: string; rate_pct: number; bir_atc_code: string | null; }

interface POForBill {
  id: string; po_no: string; supplier_id: string;
  branch_id: string | null; building_id: string | null;
  cost_center_id: string | null; grow_reference_id: string | null;
  lines: { line_no: number; item_id: string | null; gl_account_id: string | null; description: string; quantity: number; unit_price: number; vat_rate: number; }[];
}

interface Line {
  line_type: 'item' | 'gl';
  item_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  ewt_code_id: string;
  ewt_rate: number;
  expense_account_id: string;
  branch_id: string;
  building_id: string;
  cost_center_id: string;
  grow_reference_id: string;
}

const EMPTY_LINE: Line = {
  line_type: 'gl', item_id: '', description: '', quantity: 1, unit_price: 0,
  vat_rate: 12, ewt_code_id: '', ewt_rate: 0, expense_account_id: '',
  branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '',
};

function NewBillForm() {
  const router = useRouter();
  const params = useSearchParams();
  const tagData = useTaggingData();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pos, setPos] = useState<POOption[]>([]);
  const [ewtCodes, setEwtCodes] = useState<TaxCode[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    supplier_id: '', bill_no: '',
    bill_date: new Date().toISOString().split('T')[0],
    due_date: '', po_id: params.get('po_id') ?? '',
    default_ewt_code_id: '',   // header default only
  });
  const [tags, setTags] = useState<TaggingValues>({ branch_id: '', building_id: '', cost_center_id: '', grow_reference_id: '' });
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    const poId = params.get('po_id');

    Promise.all([
      api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${cid}&limit=500`),
      api.get<Account[]>(`/gl/accounts?company_id=${cid}&limit=500`),
      api.get<{ data: POOption[] }>(`/purchasing/purchase-orders?company_id=${cid}&limit=500`),
      api.get<TaxCode[]>(`/bir/tax-codes?company_id=${cid}&tax_type=ewt`),
      poId ? api.get<POForBill>(`/purchasing/purchase-orders/${poId}`) : Promise.resolve(null),
    ]).then(([s, a, p, tc, poData]) => {
      setSuppliers(s.data);
      setAccounts(Array.isArray(a) ? a : []);
      setPos(p.data);
      setEwtCodes(Array.isArray(tc) ? tc : []);

      if (poData) {
        const supplier = s.data.find(x => x.id === poData.supplier_id);
        let dueDate = '';
        if (supplier?.payment_terms_days) {
          const d = new Date();
          d.setDate(d.getDate() + supplier.payment_terms_days);
          dueDate = d.toISOString().split('T')[0];
        }
        setForm(f => ({ ...f, supplier_id: poData.supplier_id, po_id: poData.id, due_date: dueDate }));
        setTags({ branch_id: poData.branch_id ?? '', building_id: poData.building_id ?? '', cost_center_id: poData.cost_center_id ?? '', grow_reference_id: poData.grow_reference_id ?? '' });
        if (poData.lines?.length) {
          setLines(poData.lines.map(l => ({
            line_type: l.item_id ? 'item' as const : 'gl' as const,
            item_id: l.item_id ?? '', description: l.description,
            quantity: l.quantity, unit_price: l.unit_price, vat_rate: l.vat_rate,
            ewt_code_id: '', ewt_rate: 0,
            expense_account_id: l.gl_account_id ?? '',
            branch_id: poData.branch_id ?? '',
            building_id: poData.building_id ?? '',
            cost_center_id: poData.cost_center_id ?? '',
            grow_reference_id: poData.grow_reference_id ?? '',
          })));
        }
      }
    }).catch(() => {});
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  function handleTagChange(field: keyof TaggingValues, val: string) {
    setTags(t => ({ ...t, [field]: val }));
    setLines(prev => prev.map(l => ({ ...l, [field]: val })));
  }

  // Header default EWT code → apply to ALL lines
  function handleDefaultEwtChange(codeId: string) {
    setForm(f => ({ ...f, default_ewt_code_id: codeId }));
    const tc = ewtCodes.find(c => c.id === codeId);
    setLines(prev => prev.map(l => ({
      ...l,
      ewt_code_id: codeId,
      ewt_rate: tc ? Number(tc.rate_pct) : 0,
    })));
  }

  // Per-line EWT code change
  function handleLineEwtCode(idx: number, codeId: string) {
    const tc = ewtCodes.find(c => c.id === codeId);
    setLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ewt_code_id: codeId, ewt_rate: tc ? Number(tc.rate_pct) : 0 };
      return next;
    });
  }

  function addLine() {
    const ref = lines[0];
    setLines(l => [...l, {
      ...EMPTY_LINE,
      ewt_code_id: ref?.ewt_code_id ?? '',
      ewt_rate: ref?.ewt_rate ?? 0,
      branch_id: tags.branch_id,
      building_id: tags.building_id,
      cost_center_id: tags.cost_center_id,
      grow_reference_id: tags.grow_reference_id,
    }]);
  }

  function updateLine(idx: number, field: keyof Line, val: string | number) {
    setLines(prev => { const next = [...prev]; next[idx] = { ...next[idx], [field]: val }; return next; });
  }

  function lineSubtotal(l: Line) { return l.quantity * l.unit_price; }
  function lineVat(l: Line)      { return lineSubtotal(l) * (l.vat_rate / 100); }
  function lineTotal(l: Line)    { return lineSubtotal(l) + lineVat(l); }
  function lineEwt(l: Line)      { return lineSubtotal(l) * (l.ewt_rate / 100); }

  const totalSubtotal = lines.reduce((s, l) => s + lineSubtotal(l), 0);
  const totalVat      = lines.reduce((s, l) => s + lineVat(l), 0);
  const grandTotal    = lines.reduce((s, l) => s + lineTotal(l), 0);
  const totalEwt      = lines.reduce((s, l) => s + lineEwt(l), 0);
  const netPayable    = grandTotal - totalEwt;

  const defaultCode = ewtCodes.find(c => c.id === form.default_ewt_code_id);

  // Determine the single EWT code used for bill-level ewt_code_id
  // Use the default header code, or the first line's code if all lines share one
  const billEwtCodeId = form.default_ewt_code_id
    || (lines.every(l => l.ewt_code_id === lines[0].ewt_code_id) ? lines[0].ewt_code_id : null)
    || null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.supplier_id) { setError('Select a supplier'); return; }
    if (!form.bill_no) { setError('Supplier invoice number is required'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const bill = await api.post<{ id: string }>('/ap/bills', {
        company_id: cid,
        supplier_id: form.supplier_id,
        bill_no: form.bill_no,
        bill_date: form.bill_date,
        due_date: form.due_date || undefined,
        po_id: form.po_id || undefined,
        ewt_code_id: billEwtCodeId || undefined,
        ...tags,
        lines: lines.map(l => ({
          ...l,
          item_id: l.item_id || undefined,
          expense_account_id: l.expense_account_id || undefined,
          ewt_code_id: l.ewt_code_id || undefined,
        })),
      });
      router.push(`/dashboard/ap/bills/${bill.id}`);
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed'); } finally { setSaving(false); }
  }

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';
  const cellSel = 'w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Bill</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Enter a vendor invoice as a draft bill.</p>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Bill Details */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Bill Details</div>
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className={lbl}>Supplier *</label>
              <SearchableSelect required value={form.supplier_id}
                onChange={v => {
                  const s = suppliers.find(x => x.id === v);
                  if (s && !form.due_date) {
                    const d = new Date(form.bill_date);
                    d.setDate(d.getDate() + s.payment_terms_days);
                    setForm(f => ({ ...f, supplier_id: v, due_date: d.toISOString().split('T')[0] }));
                  } else { setForm(f => ({ ...f, supplier_id: v })); }
                }}
                placeholder="Select supplier…"
                options={suppliers.map(s => ({ value: s.id, label: `${s.code} — ${s.name}` }))}
              />
            </div>
            <div>
              <label className={lbl}>Supplier Invoice No. *</label>
              <input required type="text" value={form.bill_no} onChange={e => setForm(f => ({ ...f, bill_no: e.target.value }))} placeholder="e.g. INV-2026-001" className={inp} />
            </div>
            <div>
              <label className={lbl}>Bill Date *</label>
              <input required type="date" value={form.bill_date} onChange={e => setForm(f => ({ ...f, bill_date: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Due Date</label>
              <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Linked PO</label>
              <select value={form.po_id} onChange={e => setForm(f => ({ ...f, po_id: e.target.value }))} className={inp}>
                <option value="">— none —</option>
                {pos.map(p => <option key={p.id} value={p.id}>{p.po_no}</option>)}
              </select>
            </div>
            {/* Default EWT code — sets all lines but each line can override */}
            <div className="col-span-2">
              <label className={lbl}>Default EWT Code <span className="text-slate-400 font-normal">(applies to all lines — override per line if needed)</span></label>
              <select value={form.default_ewt_code_id} onChange={e => handleDefaultEwtChange(e.target.value)} className={inp}>
                <option value="">— none / not subject to EWT —</option>
                {ewtCodes.map(tc => (
                  <option key={tc.id} value={tc.id}>
                    {tc.code} — {tc.name} ({Number(tc.rate_pct)}%){tc.bir_atc_code ? ` · ATC: ${tc.bir_atc_code}` : ''}
                  </option>
                ))}
              </select>
              {defaultCode && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Default: {defaultCode.code} · {Number(defaultCode.rate_pct)}% · each line can use a different code
                </p>
              )}
            </div>
            <TaggingFields value={tags} data={tagData} onChange={handleTagChange} />
          </div>
        </div>

        {/* Line Items */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Line Items</div>
            <button type="button" onClick={addLine} className="text-xs text-brand-600 hover:underline dark:text-brand-400">+ Add line</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium w-24">Type</th>
                  <th className="px-2 py-1.5 text-left font-medium w-40">Account / Item</th>
                  <th className="px-2 py-1.5 text-left font-medium">Description *</th>
                  <th className="px-2 py-1.5 text-right font-medium w-16">Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24">Unit Price</th>
                  <th className="px-2 py-1.5 text-right font-medium w-14">VAT %</th>
                  <th className="px-2 py-1.5 text-left font-medium w-36 text-amber-700 dark:text-amber-400">EWT Code</th>
                  <th className="px-2 py-1.5 text-right font-medium w-14 text-amber-700 dark:text-amber-400">EWT %</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24 text-amber-700 dark:text-amber-400">EWT Amt</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24">Total</th>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Location</th>
                  <th className="px-2 py-1.5 text-left font-medium w-20">Building</th>
                  <th className="px-2 py-1.5 text-left font-medium w-24">Cost Center</th>
                  <th className="px-2 py-1.5 text-left font-medium w-28">Grow</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const lineCode = ewtCodes.find(c => c.id === l.ewt_code_id);
                  return (
                    <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-1">
                        <select value={l.line_type} onChange={e => updateLine(idx, 'line_type', e.target.value)} className={cellSel}>
                          <option value="gl">GL Account</option>
                          <option value="item">Item</option>
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        {l.line_type === 'gl'
                          ? (<select value={l.expense_account_id} onChange={e => updateLine(idx, 'expense_account_id', e.target.value)} className={cellSel}>
                              <option value="">Select account…</option>
                              {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                            </select>)
                          : <span className="px-1 text-slate-400 italic">—</span>}
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
                      {/* Per-line EWT Code */}
                      <td className="px-2 py-1">
                        <select value={l.ewt_code_id} onChange={e => handleLineEwtCode(idx, e.target.value)}
                          className="w-full rounded border border-amber-300 bg-amber-50 px-1 py-1 text-xs dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                          <option value="">— none —</option>
                          {ewtCodes.map(tc => (
                            <option key={tc.id} value={tc.id}>
                              {tc.code} ({Number(tc.rate_pct)}%)
                            </option>
                          ))}
                        </select>
                        {lineCode && (
                          <div className="mt-0.5 truncate text-[10px] text-amber-600 dark:text-amber-400">{lineCode.name}</div>
                        )}
                      </td>
                      {/* EWT Rate — auto-filled from code, manually editable */}
                      <td className="px-2 py-1">
                        <NumericInput value={l.ewt_rate} onChange={v => updateLine(idx, 'ewt_rate', v)} min={0} decimals={2}
                          className="w-full rounded border border-slate-300 px-1 py-1 text-right text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-amber-700 dark:text-amber-400">
                        {lineEwt(l) > 0 ? `(${lineEwt(l).toLocaleString('en-PH', { minimumFractionDigits: 2 })})` : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono dark:text-slate-300">
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
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <td colSpan={9} className="px-2 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">Subtotal</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-slate-700 dark:text-slate-300">{totalSubtotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td colSpan={5} />
                </tr>
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <td colSpan={9} className="px-2 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">VAT</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-slate-700 dark:text-slate-300">{totalVat.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td colSpan={5} />
                </tr>
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <td colSpan={9} className="px-2 py-1.5 text-right text-xs font-medium text-slate-600 dark:text-slate-300">Gross Total (incl. VAT)</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs font-medium text-slate-700 dark:text-slate-300">{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td colSpan={5} />
                </tr>
                {totalEwt > 0 && (
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <td colSpan={9} className="px-2 py-1.5 text-right text-xs text-amber-700 dark:text-amber-400">
                      Less: EWT Withheld
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs text-amber-700 dark:text-amber-400">
                      ({totalEwt.toLocaleString('en-PH', { minimumFractionDigits: 2 })})
                    </td>
                    <td colSpan={5} />
                  </tr>
                )}
                <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <td colSpan={9} className="px-2 py-2 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">Net Payable to Supplier</td>
                  <td className="px-2 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                    ₱{netPayable.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
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

export default function NewBillPage() { return <Suspense><NewBillForm /></Suspense>; }
