'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Item      { id: string; sku: string; name: string; uom: string; }
interface Location  { id: string; code: string; name: string; warehouse_id: string | null; }
interface POOption  { id: string; po_no: string; supplier_name: string; }
interface StockBal  { item_id: string; qty_on_hand: number; warehouse_id: string; avg_cost: number; }
interface LiveStock { item_id: string; qty_heads: number; qty_kgs: number; avg_cost: number; sku: string; item_name: string; uom: string; tally_no: string | null; tally_id: string | null; }

interface ConversionSeed {
  tally_sheet_id: string;
  transaction_date: string;
  branch_id: string;
  lines: Array<{ item_id: string; item_name: string; sku: string; heads: number; net_kgs: number; }>;
}

function readSeed(): ConversionSeed | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('pending_conversion');
    if (!raw) return null;
    sessionStorage.removeItem('pending_conversion');
    return JSON.parse(raw) as ConversionSeed;
  } catch { return null; }
}

interface SourceLine {
  item_id: string; item_sku: string; item_name: string;
  uom: string; available: number; heads: number; kgs: number;
  doa_heads: number; doa_kgs: number;
  short_over_heads: number; short_over_kgs: number;
}
interface OutputLine {
  output_item_id: string; item_sku: string; item_name: string;
  category: string; uom: string; heads: number; kgs: number;
  price_per_kg: number; dressing_fee: number; delivery_ref_no: string;
}
// amount       = kgs × price_per_kg
// total_amount = amount + dressing_fee

const inp = 'w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none';
const sel = 'w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none';
const lbl = 'mb-0.5 block text-xs font-medium text-brand-600 dark:text-brand-400';
const tinp = 'w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

function NewConversionForm() {
  const router = useRouter();
  // useSearchParams kept only so the Suspense boundary is satisfied
  useSearchParams();

  // Read seed synchronously — sessionStorage is available before any async effects
  const [seed] = useState<ConversionSeed | null>(readSeed);

  const [items, setItems]         = useState<Item[]>([]);
  const [liveStock, setLiveStock] = useState<LiveStock[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [pos, setPos]             = useState<POOption[]>([]);
  const [stock, setStock]         = useState<StockBal[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState({
    transaction_date: seed?.transaction_date || today,
    po_id: '',
    branch_id: seed?.branch_id ?? '',
    target_branch_id: '',
    remarks: '',
    tally_sheet_id: seed?.tally_sheet_id ?? '',
  });

  // Source item form (one at a time → added to table)
  const [srcForm, setSrcForm] = useState({ item_id: '', heads: '', kgs: '', doa_heads: '', doa_kgs: '', short_over_heads: '', short_over_kgs: '' });

  // Pre-populate source lines from seed immediately (UOM filled in once items load)
  const [sourceLines, setSourceLines] = useState<SourceLine[]>(
    seed?.lines.map(l => ({
      item_id: l.item_id, item_sku: l.sku, item_name: l.item_name,
      uom: '', available: 0, heads: Number(l.heads), kgs: Number(l.net_kgs),
      doa_heads: 0, doa_kgs: 0, short_over_heads: 0, short_over_kgs: 0,
    })) ?? []
  );

  // Output item form (one at a time → added to table)
  const [outForm, setOutForm] = useState({ output_item_id: '', category: '', heads: '', kgs: '', price_per_kg: '', dressing_fee: '', delivery_ref_no: '' });
  const [outputLines, setOutputLines] = useState<OutputLine[]>([]);

  // Load reference data
  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<Item[]>(`/inventory/items?company_id=${cid}&minimal=true`)
      .then(r => {
        const arr = Array.isArray(r) ? r : [];
        setItems(arr);
        if (arr.length && seed?.lines.length) {
          setSourceLines(prev => prev.map(l => ({
            ...l, uom: l.uom || arr.find(i => i.id === l.item_id)?.uom || '',
          })));
        }
      }).catch(() => {});
    api.get<LiveStock[]>(`/poultry/live-stock?company_id=${cid}`)
      .then(r => setLiveStock(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Location[]>(`/inventory/locations?company_id=${cid}`).then(r => {
      const locs = Array.isArray(r) ? r : [];
      setLocations(locs);
      // Auto-set target to Chicken Trading location
      const ct = locs.find(l => l.name.toLowerCase().includes('chicken trading') || l.code.toLowerCase().includes('ct'));
      if (ct) setForm(f => ({ ...f, target_branch_id: ct.id }));
    }).catch(() => {});
    api.get<{ data: POOption[] }>(`/purchasing/purchase-orders?company_id=${cid}&status=approved&limit=200`).then(r => setPos(r.data ?? [])).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload stock when source location changes
  useEffect(() => {
    if (!form.branch_id) { setStock([]); return; }
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    const loc = locations.find(l => l.id === form.branch_id);
    const warehouseId = loc?.warehouse_id;
    const qs = warehouseId ? `&warehouse_id=${warehouseId}` : '';
    api.get<StockBal[]>(`/inventory/stock-on-hand?company_id=${cid}${qs}`)
      .then(r => setStock(Array.isArray(r) ? r : []))
      .catch(() => {});
  }, [form.branch_id, locations]);

  function getAvailable(itemId: string) {
    return liveStock.filter(s => s.item_id === itemId).reduce((t, s) => t + s.qty_kgs, 0);
  }

  function getAvgCost(itemId: string) {
    const rows = liveStock.filter(s => s.item_id === itemId);
    const totalQty = rows.reduce((t, s) => t + s.qty_kgs, 0);
    if (totalQty <= 0) return 0;
    return rows.reduce((t, s) => t + s.qty_kgs * s.avg_cost, 0) / totalQty;
  }

  function getLiveRef(itemId: string) {
    const row = liveStock.find(s => s.item_id === itemId);
    return row?.tally_no ?? null;
  }

  function addSourceLine() {
    if (!srcForm.item_id) return;
    const live = liveStock.find(s => s.item_id === srcForm.item_id);
    const item = live ?? items.find(i => i.id === srcForm.item_id);
    if (!item) return;
    const sku  = live ? live.sku       : (item as Item).sku;
    const name = live ? live.item_name : (item as Item).name;
    const uom  = live ? live.uom       : (item as Item).uom;
    const avgCost = getAvgCost(srcForm.item_id);
    setSourceLines(prev => [...prev, {
      item_id: srcForm.item_id, item_sku: sku, item_name: name,
      uom, available: getAvailable(srcForm.item_id),
      heads: parseFloat(srcForm.heads) || 0, kgs: parseFloat(srcForm.kgs) || 0,
      doa_heads: parseFloat(srcForm.doa_heads) || 0,
      doa_kgs: parseFloat(srcForm.doa_kgs) || 0,
      short_over_heads: parseFloat(srcForm.short_over_heads) || 0,
      short_over_kgs: parseFloat(srcForm.short_over_kgs) || 0,
    }]);
    setOutForm(f => ({ ...f, price_per_kg: avgCost > 0 ? avgCost.toFixed(4) : f.price_per_kg }));
    setSrcForm({ item_id: '', heads: '', kgs: '', doa_heads: '', doa_kgs: '', short_over_heads: '', short_over_kgs: '' });
  }

  function addOutputLine() {
    if (!outForm.output_item_id) return;
    const item = items.find(i => i.id === outForm.output_item_id);
    if (!item) return;
    setOutputLines(prev => [...prev, {
      output_item_id: outForm.output_item_id, item_sku: item.sku, item_name: item.name,
      category: outForm.category, uom: item.uom,
      heads: parseFloat(outForm.heads) || 0, kgs: parseFloat(outForm.kgs) || 0,
      price_per_kg: parseFloat(outForm.price_per_kg) || 0,
      dressing_fee: parseFloat(outForm.dressing_fee) || 0,
      delivery_ref_no: outForm.delivery_ref_no,
    }]);
    // Keep price_per_kg for next line; clear the rest
    setOutForm(f => ({ output_item_id: '', category: '', heads: '', kgs: '', price_per_kg: f.price_per_kg, dressing_fee: '', delivery_ref_no: '' }));
  }

  const totalSrcKgs        = sourceLines.reduce((s, l) => s + l.kgs, 0);
  const totalSrcHeads      = sourceLines.reduce((s, l) => s + l.heads, 0);
  const totalDoaHeads      = sourceLines.reduce((s, l) => s + l.doa_heads, 0);
  const totalDoaKgs        = sourceLines.reduce((s, l) => s + l.doa_kgs, 0);
  const totalShortOvrHeads = sourceLines.reduce((s, l) => s + l.short_over_heads, 0);
  const totalShortOvrKgs   = sourceLines.reduce((s, l) => s + l.short_over_kgs, 0);
  const totalOutKgs      = outputLines.reduce((s, l) => s + l.kgs, 0);
  const totalOutHeads    = outputLines.reduce((s, l) => s + l.heads, 0);
  const totalOutAmount   = outputLines.reduce((s, l) => s + l.kgs * l.price_per_kg, 0);
  const totalDressingFee = outputLines.reduce((s, l) => s + l.dressing_fee, 0);
  const totalOutTotal    = totalOutAmount + totalDressingFee;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!sourceLines.length) { setError('Add at least one source item'); return; }
    if (!outputLines.length) { setError('Add at least one output item'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const orNull = (v: string) => v || null;
      // Use first source line as the primary source_item (schema constraint)
      const primary = sourceLines[0];
      const rec = await api.post<{ id: string }>('/poultry/conversions', {
        company_id:        cid,
        transaction_date:  form.transaction_date,
        po_id:             orNull(form.po_id),
        branch_id:         orNull(form.branch_id),
        target_branch_id:  orNull(form.target_branch_id),
        tally_sheet_id:    orNull(form.tally_sheet_id),
        remarks:           orNull(form.remarks),
        source_item_id:    primary.item_id,
        source_heads:      totalSrcHeads,
        source_kgs:        totalSrcKgs,
        doa_heads:         totalDoaHeads,
        doa_kgs:           totalDoaKgs,
        short_over_heads:  totalShortOvrHeads,
        short_over_kgs:    totalShortOvrKgs,
        outputs: outputLines.map(o => ({
          output_item_id:  o.output_item_id,
          category:        o.category || null,
          heads:           o.heads,
          kgs:             o.kgs,
          unit_cost:       o.price_per_kg,
          dressing_fee:    o.dressing_fee,
          delivery_ref_no: o.delivery_ref_no || null,
        })),
      });
      router.push(`/dashboard/poultry/conversions/${rec.id}`);
    } catch (e: unknown) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-0">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Create Item Conversion</h1>
        <button type="button" onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-xl leading-none">←</button>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-0">
        {/* Header */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
          <div className="grid grid-cols-4 gap-x-8 gap-y-5">
            <div>
              <label className={lbl}>Transaction No.</label>
              <div className="border-b border-slate-200 py-1 text-sm text-slate-400">(auto)</div>
            </div>
            <div>
              <label className={lbl}>Transaction Date *</label>
              <input required type="date" className={inp} value={form.transaction_date}
                onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))} />
            </div>
            <div className="hidden">
              <label className={lbl}>Purchase Order</label>
              <select className={sel} value={form.po_id} onChange={e => setForm(f => ({ ...f, po_id: e.target.value }))}>
                <option value="">— none —</option>
                {pos.map(p => <option key={p.id} value={p.id}>{p.po_no} — {p.supplier_name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Status</label>
              <div className="border-b border-slate-200 py-1 text-sm text-slate-400">NEW</div>
            </div>

            <div className="hidden">
              <label className={lbl}>Source Location *</label>
              <select className={sel} value={form.branch_id}
                onChange={e => { setForm(f => ({ ...f, branch_id: e.target.value })); setSrcForm({ item_id: '', heads: '', kgs: '' }); setSourceLines([]); }}>
                <option value="">— select —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={lbl}>Remarks</label>
              <input className={inp} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
            </div>
            <div />

            <div className="hidden">
              <label className={lbl}>Target Location *</label>
              <select className={sel} value={form.target_branch_id} onChange={e => setForm(f => ({ ...f, target_branch_id: e.target.value }))}>
                <option value="">— select —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Source Item */}
        <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Source Item</h2>
          </div>
          <div className="px-6 py-4">
            {/* Add-one-at-a-time inputs */}
            <div className="mb-3 flex items-end gap-4">
              <div className="flex-1">
                <label className={lbl}>Item *</label>
                <select className={sel} value={srcForm.item_id} onChange={e => {
                  const itemId = e.target.value;
                  setSrcForm(f => ({ ...f, item_id: itemId }));
                  // Auto-fill source branch from the tally sheet that sourced this stock
                  if (itemId) {
                    const live = liveStock.find(s => s.item_id === itemId);
                    if (live?.tally_id) {
                      api.get<Record<string, unknown>>(`/poultry/tally-sheets/${live.tally_id}`)
                        .then(t => {
                          const src = (t.destination_id ?? t.branch_id) as string | null;
                          if (src) setForm(f => ({ ...f, branch_id: src, tally_sheet_id: live.tally_id ?? f.tally_sheet_id }));
                        }).catch(() => {});
                    }
                  }
                }}>
                  <option value="">{liveStock.length ? 'Select item…' : 'No live inventory available'}</option>
                  {liveStock.map(s => {
                    const ref = s.tally_no ? ` · ${s.tally_no}` : '';
                    return <option key={s.item_id} value={s.item_id}>{s.sku} — {s.item_name} ({s.qty_kgs.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KGS avail.{ref})</option>;
                  })}
                </select>
              </div>
              <div className="w-20">
                <label className={lbl}>Unit</label>
                <div className="border-b border-slate-200 py-1 text-sm text-slate-500">
                  {liveStock.find(s => s.item_id === srcForm.item_id)?.uom ?? '—'}
                </div>
              </div>
              <div className="w-24">
                <label className={lbl}>Available</label>
                <div className="border-b border-slate-200 py-1 text-sm text-slate-500">
                  {srcForm.item_id ? getAvailable(srcForm.item_id).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </div>
              </div>
              <div className="w-20">
                <label className={lbl}>Heads</label>
                <input type="number" min={0} className={inp} value={srcForm.heads}
                  onChange={e => setSrcForm(f => ({ ...f, heads: e.target.value }))} />
              </div>
              <div className="w-24">
                <label className={lbl}>KGS</label>
                <input type="number" min={0} step="any" className={inp} value={srcForm.kgs}
                  onChange={e => setSrcForm(f => ({ ...f, kgs: e.target.value }))} />
              </div>
              <div className="w-20">
                <label className={lbl}>DOA Heads</label>
                <input type="number" min={0} className={inp} value={srcForm.doa_heads}
                  onChange={e => setSrcForm(f => ({ ...f, doa_heads: e.target.value }))} placeholder="0" />
              </div>
              <div className="w-20">
                <label className={lbl}>DOA KGS</label>
                <input type="number" min={0} step="any" className={inp} value={srcForm.doa_kgs}
                  onChange={e => setSrcForm(f => ({ ...f, doa_kgs: e.target.value }))} placeholder="0" />
              </div>
              <div className="w-24">
                <label className={lbl}>S/O Heads</label>
                <input type="number" step="any" className={inp} value={srcForm.short_over_heads}
                  onChange={e => setSrcForm(f => ({ ...f, short_over_heads: e.target.value }))} placeholder="0" />
              </div>
              <div className="w-24">
                <label className={lbl}>S/O KGS</label>
                <input type="number" step="any" className={inp} value={srcForm.short_over_kgs}
                  onChange={e => setSrcForm(f => ({ ...f, short_over_kgs: e.target.value }))} placeholder="0" />
              </div>
              <button type="button" onClick={addSourceLine}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-brand-400 text-brand-500 hover:bg-brand-50 text-lg font-light">
                +
              </button>
            </div>

            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-left font-medium">Unit</th>
                  <th className="px-3 py-2 text-right font-medium">Heads</th>
                  <th className="px-3 py-2 text-right font-medium">KGS</th>
                  <th className="px-3 py-2 text-right font-medium">DOA Heads</th>
                  <th className="px-3 py-2 text-right font-medium">DOA KGS</th>
                  <th className="px-3 py-2 text-right font-medium">S/O Heads</th>
                  <th className="px-3 py-2 text-right font-medium">S/O KGS</th>
                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sourceLines.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-4 text-center text-slate-400">No data available in table</td></tr>
                ) : sourceLines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                    <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2 font-medium dark:text-slate-200">{l.item_sku} — {l.item_name}</td>
                    <td className="px-3 py-2 text-slate-500">{l.uom}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.heads.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.kgs.toFixed(6)}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.doa_heads || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.doa_kgs ? l.doa_kgs.toFixed(4) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.short_over_heads || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.short_over_kgs ? l.short_over_kgs.toFixed(4) : '—'}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setSourceLines(prev => prev.filter((_, j) => j !== i))}
                        className="text-xs text-red-500 hover:text-red-700">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {sourceLines.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    <td colSpan={3} className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{totalSrcHeads.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{totalSrcKgs.toFixed(6)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{totalDoaHeads || ''}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{totalDoaKgs ? totalDoaKgs.toFixed(4) : ''}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{totalShortOvrHeads || ''}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{totalShortOvrKgs ? totalShortOvrKgs.toFixed(4) : ''}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>

          </div>
        </div>

        {/* Output Items */}
        <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Output Items</h2>
          </div>
          <div className="px-6 py-4">
            {/* Add-one-at-a-time inputs */}
            <div className="mb-3 grid grid-cols-12 items-end gap-2">
              <div className="col-span-1">
                <label className={lbl}>Category</label>
                <input className={inp} value={outForm.category}
                  onChange={e => setOutForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. A" />
              </div>
              <div className="col-span-3">
                <label className={lbl}>Output Item *</label>
                <select className={sel} value={outForm.output_item_id} onChange={e => setOutForm(f => ({ ...f, output_item_id: e.target.value }))}>
                  <option value="">Select item…</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                </select>
              </div>
              <div className="col-span-1">
                <label className={lbl}>Unit</label>
                <div className="border-b border-slate-200 py-1 text-sm text-slate-500">
                  {items.find(i => i.id === outForm.output_item_id)?.uom ?? '—'}
                </div>
              </div>
              <div className="col-span-1">
                <label className={lbl}>KGS</label>
                <input type="number" min={0} step="any" className={inp} value={outForm.kgs}
                  onChange={e => setOutForm(f => ({ ...f, kgs: e.target.value }))} />
              </div>
              <div className="col-span-1">
                <label className={lbl}>Heads</label>
                <input type="number" min={0} className={inp} value={outForm.heads}
                  onChange={e => setOutForm(f => ({ ...f, heads: e.target.value }))} />
              </div>
              <div className="col-span-1">
                <label className={lbl}>Price/kg</label>
                <input type="number" min={0} step="any" className={inp} value={outForm.price_per_kg}
                  onChange={e => setOutForm(f => ({ ...f, price_per_kg: e.target.value }))} />
              </div>
              <div className="col-span-1">
                <label className={lbl}>Amount</label>
                <div className="border-b border-slate-200 py-1 text-sm text-slate-500 text-right font-mono">
                  {((parseFloat(outForm.kgs) || 0) * (parseFloat(outForm.price_per_kg) || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="col-span-1">
                <label className={lbl}>Dressing Fee</label>
                <input type="number" min={0} step="any" className={inp} value={outForm.dressing_fee}
                  onChange={e => setOutForm(f => ({ ...f, dressing_fee: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="col-span-1">
                <label className={lbl}>Total</label>
                <div className="border-b border-slate-200 py-1 text-sm text-slate-700 dark:text-slate-200 text-right font-mono font-semibold">
                  {((parseFloat(outForm.kgs) || 0) * (parseFloat(outForm.price_per_kg) || 0) + (parseFloat(outForm.dressing_fee) || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="col-span-1">
                <label className={lbl}>Delivery Ref</label>
                <input className={inp} value={outForm.delivery_ref_no}
                  onChange={e => setOutForm(f => ({ ...f, delivery_ref_no: e.target.value }))} />
              </div>
              <div className="col-span-1 flex items-end justify-center">
                <button type="button" onClick={addOutputLine}
                  className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-brand-400 text-brand-500 hover:bg-brand-50 text-lg font-light">
                  +
                </button>
              </div>
            </div>

            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-left font-medium">Unit</th>
                  <th className="px-3 py-2 text-right font-medium">Heads</th>
                  <th className="px-3 py-2 text-right font-medium">KGS</th>
                  <th className="px-3 py-2 text-right font-medium">Price/kg</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Dressing Fee</th>
                  <th className="px-3 py-2 text-right font-medium">Total Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Delivery Ref</th>
                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {outputLines.length === 0 ? (
                  <tr><td colSpan={11} className="px-3 py-4 text-center text-slate-400">No data available in table</td></tr>
                ) : outputLines.map((o, i) => {
                  const amount = o.kgs * o.price_per_kg;
                  const total  = amount + o.dressing_fee;
                  return (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                      <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium dark:text-slate-200">
                        {o.category && <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{o.category}</span>}
                        {o.item_sku} — {o.item_name}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{o.uom}</td>
                      <td className="px-3 py-2 text-right font-mono">{o.heads.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{o.kgs.toFixed(6)}</td>
                      <td className="px-3 py-2 text-right font-mono">{o.price_per_kg.toLocaleString('en-PH', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
                      <td className="px-3 py-2 text-right font-mono">{amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right font-mono">{o.dressing_fee.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-slate-500">{o.delivery_ref_no || '—'}</td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setOutputLines(prev => prev.filter((_, j) => j !== i))}
                          className="text-xs text-red-500 hover:text-red-700">Remove</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {outputLines.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold">
                    <td colSpan={3} className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total</td>
                    <td className="px-3 py-2 text-right font-mono">{totalOutHeads.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono">{totalOutKgs.toFixed(6)}</td>
                    <td />
                    <td className="px-3 py-2 text-right font-mono">{totalOutAmount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right font-mono">{totalDressingFee.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right font-mono">{totalOutTotal.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 px-6 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewConversionPage() {
  return <Suspense><NewConversionForm /></Suspense>;
}
