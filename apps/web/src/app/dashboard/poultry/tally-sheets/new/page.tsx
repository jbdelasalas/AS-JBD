'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Cycle      { id: string; doc_no: string; }
interface Supplier   { id: string; name: string; code: string; }
interface Branch     { id: string; name: string; code: string; }
interface Item       { id: string; sku: string; name: string; }
interface GrowRef    { id: string; code: string; name: string; }
interface CostCenter { id: string; code: string; name: string; }
interface Building       { id: string; code: string; name: string; branch_id?: string | null; }
interface DeliveryMethod { id: string; code: string; name: string; }

interface Line { item_id: string; heads: number; gross_kgs: number; crate_kgs: number; net_kgs: number; remarks: string; }

const inp = 'w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none';
const sel = 'w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none';
const lbl = 'mb-0.5 block text-xs font-medium text-brand-600 dark:text-brand-400';
const tinp = 'w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

function NewTallySheetForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [cycles, setCycles]         = useState<Cycle[]>([]);
  const [suppliers, setSuppliers]   = useState<Supplier[]>([]);
  const [branches, setBranches]     = useState<Branch[]>([]);
  const [items, setItems]           = useState<Item[]>([]);
  const [growRefs, setGrowRefs]     = useState<GrowRef[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [buildings, setBuildings]         = useState<Building[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<DeliveryMethod[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const [form, setForm] = useState({
    grow_cycle_id:    params.get('grow_cycle_id') ?? '',
    tally_type:       params.get('tally_type') ?? 'harvest',
    transfer_date:    new Date().toISOString().split('T')[0],
    reference_id:     '',
    supplier_id:      '',
    destination_id:   '',
    harvested_heads:  params.get('harvested_heads') ?? '',
    received_by:      '',
    checked_by:       '',
    issued_by:        '',
    start_time:       '',
    end_time:         '',
    remarks:          params.get('remarks') ?? '',
    reject_kgs:       '',
    reject_heads:     '',
    replacement_kgs:  '',
    replacement_heads:'',
    delivery_method:  '',
    plate_number:     '',
    driver:           '',
    branch_id:        '',
    building_id:      '',
    cost_center_id:   '',
    grow_reference_id:'',
  });

  const [lines, setLines] = useState<Line[]>([
    { item_id: '', heads: 0, gross_kgs: 0, crate_kgs: 0, net_kgs: 0, remarks: '' },
  ]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: Cycle[] }>(`/poultry/grow-cycles?company_id=${cid}&status=active&limit=100`).then(r => setCycles(r.data ?? [])).catch(() => {});
    api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${cid}&minimal=true&limit=500`).then(r => setSuppliers(r.data ?? [])).catch(() => {});
    api.get<Branch[]>(`/admin/branches?company_id=${cid}`).then(r => setBranches(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&minimal=true`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<GrowRef[]>(`/poultry/grow-references?company_id=${cid}`).then(r => setGrowRefs(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<CostCenter[]>(`/admin/cost-centers?company_id=${cid}&limit=100`).then(r => setCostCenters(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Building[]>(`/poultry/buildings?company_id=${cid}`).then(r => setBuildings(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<DeliveryMethod[]>(`/admin/delivery-methods?company_id=${cid}`).then(r => setDeliveryMethods(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  function setF(field: string, value: string | number) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function updateLine(i: number, field: keyof Line, value: string | number) {
    setLines(prev => {
      const next = [...prev];
      const line = { ...next[i], [field]: value };
      if (field === 'gross_kgs' || field === 'crate_kgs') {
        line.net_kgs = Math.max(0, Number(line.gross_kgs) - Number(line.crate_kgs));
      }
      next[i] = line;
      return next;
    });
  }

  const netKgs   = lines.reduce((s, l) => s + l.net_kgs, 0);
  const netHeads = lines.reduce((s, l) => s + l.heads, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const orNull = (v: string) => v || null;
      const rec = await api.post<{ id: string }>('/poultry/tally-sheets', {
        company_id:        cid,
        tally_type:        form.tally_type,
        grow_cycle_id:     orNull(form.grow_cycle_id),
        transfer_date:     form.transfer_date,
        reference_id:      orNull(form.reference_id),
        supplier_id:       orNull(form.supplier_id),
        destination_id:    orNull(form.destination_id),
        harvested_heads:   form.harvested_heads ? parseFloat(form.harvested_heads) : undefined,
        received_by:       orNull(form.received_by),
        issued_by:         orNull(form.issued_by),
        checked_by:        orNull(form.checked_by),
        start_time:        orNull(form.start_time),
        end_time:          orNull(form.end_time),
        remarks:           orNull(form.remarks),
        reject_kgs:        parseFloat(form.reject_kgs) || 0,
        reject_heads:      parseFloat(form.reject_heads) || 0,
        replacement_kgs:   parseFloat(form.replacement_kgs) || 0,
        replacement_heads: parseFloat(form.replacement_heads) || 0,
        delivery_method:   orNull(form.delivery_method),
        plate_number:      orNull(form.plate_number),
        driver:            orNull(form.driver),
        branch_id:         orNull(form.branch_id),
        building_id:       orNull(form.building_id),
        cost_center_id:    orNull(form.cost_center_id),
        grow_reference_id: orNull(form.grow_reference_id),
        lines,
      });
      router.push(`/dashboard/poultry/tally-sheets/${rec.id}`);
    } catch (e: unknown) { setError((e as Error).message); } finally { setSaving(false); }
  }

  const filteredBuildings = form.branch_id
    ? buildings.filter(b => !b.branch_id || b.branch_id === form.branch_id)
    : buildings;

  return (
    <div className="space-y-0">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">New Tally Sheet</h1>
        <button type="button" onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-xl leading-none">←</button>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-0">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
          <div className="grid grid-cols-5 gap-x-8 gap-y-5">

            {/* Row 1 */}
            <div>
              <label className={lbl}>Transaction Number</label>
              <div className="border-b border-slate-200 py-1 text-sm text-slate-400">(auto)</div>
            </div>
            <div>
              <label className={lbl}>Reference ID</label>
              <input className={inp} value={form.reference_id} onChange={e => setF('reference_id', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Transfer Date *</label>
              <input required type="date" className={inp} value={form.transfer_date} onChange={e => setF('transfer_date', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Growing ID</label>
              <select className={sel} value={form.grow_cycle_id} onChange={e => setF('grow_cycle_id', e.target.value)}>
                <option value="">— none —</option>
                {cycles.map(c => <option key={c.id} value={c.id}>{c.doc_no}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Status</label>
              <div className="border-b border-slate-200 py-1 text-sm">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Draft</span>
              </div>
            </div>

            {/* Row 2 */}
            <div>
              <label className={lbl}>Supplier</label>
              <select className={sel} value={form.supplier_id} onChange={e => setF('supplier_id', e.target.value)}>
                <option value="">— none —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Received By</label>
              <input className={inp} value={form.received_by} onChange={e => setF('received_by', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Checked By</label>
              <input className={inp} value={form.checked_by} onChange={e => setF('checked_by', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Harvested Heads</label>
              <input type="number" min={0} className={inp} value={form.harvested_heads} onChange={e => setF('harvested_heads', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Start Time</label>
              <input type="time" className={inp} value={form.start_time} onChange={e => setF('start_time', e.target.value)} />
            </div>

            {/* Row 3 */}
            <div>
              <label className={lbl}>Destination</label>
              <select className={sel} value={form.destination_id} onChange={e => setF('destination_id', e.target.value)}>
                <option value="">— none —</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Issued By</label>
              <input className={inp} value={form.issued_by} onChange={e => setF('issued_by', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={lbl}>Remarks</label>
              <input className={inp} value={form.remarks} onChange={e => setF('remarks', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>End Time</label>
              <input type="time" className={inp} value={form.end_time} onChange={e => setF('end_time', e.target.value)} />
            </div>

            {/* Row 4 */}
            <div>
              <label className={lbl}>Reject (KGS)</label>
              <input type="number" min={0} step="any" className={inp} value={form.reject_kgs} onChange={e => setF('reject_kgs', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Reject (Heads)</label>
              <input type="number" min={0} className={inp} value={form.reject_heads} onChange={e => setF('reject_heads', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Replacement (KGS)</label>
              <input type="number" min={0} step="any" className={inp} value={form.replacement_kgs} onChange={e => setF('replacement_kgs', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Replacement (Heads)</label>
              <input type="number" min={0} className={inp} value={form.replacement_heads} onChange={e => setF('replacement_heads', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Delivery Method</label>
              <select className={sel} value={form.delivery_method} onChange={e => setF('delivery_method', e.target.value)}>
                <option value="">— select —</option>
                {deliveryMethods.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>

            {/* Row 5 — Tagging */}
            <div>
              <label className={lbl}>Location</label>
              <select className={sel} value={form.branch_id} onChange={e => { setF('branch_id', e.target.value); setF('building_id', ''); }}>
                <option value="">— none —</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Building</label>
              <select className={sel} value={form.building_id} onChange={e => setF('building_id', e.target.value)}>
                <option value="">— none —</option>
                {filteredBuildings.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Cost Center</label>
              <select className={sel} value={form.cost_center_id} onChange={e => setF('cost_center_id', e.target.value)}>
                <option value="">— none —</option>
                {costCenters.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Grow Reference</label>
              <select className={sel} value={form.grow_reference_id} onChange={e => setF('grow_reference_id', e.target.value)}>
                <option value="">— none —</option>
                {growRefs.map(g => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Plate / Driver</label>
              <input className={inp} placeholder="Plate" value={form.plate_number} onChange={e => setF('plate_number', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Tally Details */}
        <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Tally Details</h2>
            <button type="button"
              onClick={() => setLines(l => [...l, { item_id: '', heads: 0, gross_kgs: 0, crate_kgs: 0, net_kgs: 0, remarks: '' }])}
              className="text-xs text-brand-600 hover:underline">+ Add line</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Line #</th>
                  <th className="px-3 py-2 text-left font-medium w-48">Item</th>
                  <th className="px-3 py-2 text-right font-medium w-24">Heads</th>
                  <th className="px-3 py-2 text-right font-medium w-24">Gross KGS</th>
                  <th className="px-3 py-2 text-right font-medium w-24">Crate KGS</th>
                  <th className="px-3 py-2 text-right font-medium w-28">Quantity (KGS)</th>
                  <th className="px-3 py-2 text-left font-medium">Reference</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                    <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-1">
                      <select value={l.item_id} onChange={e => updateLine(i, 'item_id', e.target.value)} className={tinp}>
                        <option value="">Select item…</option>
                        {items.map(it => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1">
                      <input type="number" min={0} value={l.heads} onChange={e => updateLine(i, 'heads', parseFloat(e.target.value) || 0)} className={`${tinp} text-right`} />
                    </td>
                    <td className="px-3 py-1">
                      <input type="number" min={0} step="any" value={l.gross_kgs} onChange={e => updateLine(i, 'gross_kgs', parseFloat(e.target.value) || 0)} className={`${tinp} text-right`} />
                    </td>
                    <td className="px-3 py-1">
                      <input type="number" min={0} step="any" value={l.crate_kgs} onChange={e => updateLine(i, 'crate_kgs', parseFloat(e.target.value) || 0)} className={`${tinp} text-right`} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{l.net_kgs.toFixed(6)}</td>
                    <td className="px-3 py-1">
                      <input type="text" value={l.remarks} onChange={e => updateLine(i, 'remarks', e.target.value)} className={tinp} />
                    </td>
                    <td className="px-2 py-1 text-center">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines(l => l.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <td colSpan={2} className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{netHeads.toLocaleString()}</td>
                  <td colSpan={2} />
                  <td className="px-3 py-2 text-right font-mono font-semibold">{netKgs.toFixed(6)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-3">
            <button type="submit" disabled={saving}
              className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => router.back()}
              className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50">
              Cancel
            </button>
          </div>
          <div className="flex gap-6 text-xs text-slate-500">
            <span>Net Heads: <strong className="text-slate-800 dark:text-slate-200">{netHeads.toLocaleString()}</strong></span>
            <span>Net KGS: <strong className="text-slate-800 dark:text-slate-200">{netKgs.toFixed(2)}</strong></span>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function NewTallySheetPage() {
  return <Suspense><NewTallySheetForm /></Suspense>;
}
