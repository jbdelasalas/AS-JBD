'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Supplier { id: string; name: string; code: string; }
interface Branch   { id: string; name: string; code: string; }
interface Item     { id: string; sku: string; name: string; }
interface GrowRef  { id: string; code: string; name: string; }
interface CostCenter { id: string; code: string; name: string; }
interface Building       { id: string; code: string; name: string; branch_id?: string | null; }
interface DeliveryMethod { id: string; code: string; name: string; }

interface Line {
  id?: string; line_no: number; item_id: string;
  item_name?: string; sku?: string;
  heads: number; gross_kgs: number; crate_kgs: number; net_kgs: number; remarks: string;
}

interface TallySheet {
  id: string; doc_no: string; status: string; tally_type: string;
  grow_cycle_id: string | null; grow_cycle_no: string | null;
  supplier_id: string | null; supplier_name: string | null;
  destination_id: string | null; destination_name: string | null;
  branch_id: string | null; building_id: string | null;
  cost_center_id: string | null; grow_reference_id: string | null;
  transfer_date: string; reference_id: string | null;
  harvested_heads: number; reject_kgs: number; reject_heads: number;
  replacement_kgs: number; replacement_heads: number;
  net_heads: number; net_kgs: number;
  received_by: string | null; issued_by: string | null; checked_by: string | null;
  delivery_method: string | null; plate_number: string | null;
  driver: string | null; helper: string | null;
  start_time: string | null; end_time: string | null; remarks: string | null;
  lines: Line[];
}

const STATUS_COLORS: Record<string, string> = {
  saved:    'bg-slate-100 text-slate-700',
  posted:   'bg-emerald-100 text-emerald-700',
  voided:   'bg-red-100 text-red-700',
  confirmed:'bg-blue-100 text-blue-700',
};

const inp  = 'w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none disabled:text-slate-400';
const sel  = 'w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none disabled:opacity-60';
const lbl  = 'mb-0.5 block text-xs font-medium text-brand-600 dark:text-brand-400';
const tinp = 'w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

export default function TallySheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<TallySheet | null>(null);
  const [form, setForm] = useState<Partial<TallySheet>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Reference data
  const [suppliers, setSuppliers]   = useState<Supplier[]>([]);
  const [branches, setBranches]     = useState<Branch[]>([]);
  const [items, setItems]           = useState<Item[]>([]);
  const [growRefs, setGrowRefs]     = useState<GrowRef[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [buildings, setBuildings]         = useState<Building[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<DeliveryMethod[]>([]);

  const load = useCallback(() => {
    api.get<TallySheet>(`/poultry/tally-sheets/${id}`).then(d => {
      setDoc(d);
      setForm({ ...d });
      setLines(d.lines.map(l => ({ ...l })));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    try { const u = JSON.parse(localStorage.getItem('user') ?? 'null'); setIsAdmin(u?.is_superadmin === true); } catch {}
  }, []);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: Supplier[] }>(`/ap/suppliers?company_id=${cid}&minimal=true&limit=500`).then(r => setSuppliers(r.data ?? [])).catch(() => {});
    api.get<Branch[]>(`/admin/branches?company_id=${cid}`).then(r => setBranches(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Item[]>(`/inventory/items?company_id=${cid}&minimal=true`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<GrowRef[]>(`/poultry/grow-references?company_id=${cid}`).then(r => setGrowRefs(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<CostCenter[]>(`/admin/cost-centers?company_id=${cid}&limit=100`).then(r => setCostCenters(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Building[]>(`/poultry/buildings?company_id=${cid}`).then(r => setBuildings(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<DeliveryMethod[]>(`/admin/delivery-methods?company_id=${cid}`).then(r => setDeliveryMethods(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const isEditable = doc?.status === 'saved';

  async function handleDelete() {
    if (!window.confirm('Delete this tally sheet? This cannot be undone.')) return;
    setBusy(true); setMsg(null);
    try { await api.delete(`/poultry/tally-sheets/${id}`); router.push('/dashboard/poultry/tally-sheets'); }
    catch (e: unknown) { setMsg({ text: (e as Error).message ?? 'Delete failed', type: 'error' }); setBusy(false); }
  }

  function setF(field: keyof TallySheet, value: unknown) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function updateLine(i: number, field: keyof Line, value: unknown) {
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

  async function save() {
    setSaving(true); setMsg(null);
    try {
      await api.patch(`/poultry/tally-sheets/${id}`, { ...form, lines });
      setMsg({ text: 'Saved successfully', type: 'success' });
      load();
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' });
    } finally { setSaving(false); }
  }

  async function action(act: string) {
    setBusy(true); setMsg(null);
    try { await api.post(`/poultry/tally-sheets/${id}/${act}`, {}); load(); }
    catch (e: unknown) { setMsg({ text: (e as Error).message, type: 'error' }); }
    finally { setBusy(false); }
  }

  const netKgs   = lines.reduce((s, l) => s + Number(l.net_kgs), 0);
  const netHeads = lines.reduce((s, l) => s + Number(l.heads), 0);

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  if (!doc) return <div className="py-12 text-center text-sm text-red-500">Not found.</div>;

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">View Tally Sheet</h1>
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-xl leading-none">←</button>
      </div>

      {msg && (
        <div className={`mb-4 rounded border px-3 py-2 text-sm ${msg.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {/* Main form card */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
        <div className="grid grid-cols-5 gap-x-8 gap-y-5">

          {/* Row 1 */}
          <div>
            <label className={lbl}>Transaction Number</label>
            <div className="border-b border-slate-200 py-1 text-sm font-mono text-slate-700 dark:text-slate-300">{doc.doc_no}</div>
          </div>
          <div>
            <label className={lbl}>Reference ID{isEditable ? '*' : ''}</label>
            <input className={inp} value={form.reference_id ?? ''} disabled={!isEditable}
              onChange={e => setF('reference_id', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Transfer Date</label>
            <input type="date" className={inp} value={form.transfer_date ?? ''} disabled={!isEditable}
              onChange={e => setF('transfer_date', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Growing ID</label>
            <div className="border-b border-slate-200 py-1 text-sm text-slate-700 dark:text-slate-300">
              {doc.grow_cycle_no
                ? <Link href={`/dashboard/poultry/grow-cycles/${doc.grow_cycle_id}`} className="text-brand-600 hover:underline">{doc.grow_cycle_no}</Link>
                : '—'}
            </div>
          </div>
          <div>
            <label className={lbl}>Status</label>
            <div className="pt-1">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[doc.status] ?? 'bg-slate-100 text-slate-600'}`}>
                {doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
              </span>
            </div>
          </div>

          {/* Row 2 */}
          <div>
            <label className={lbl}>Supplier{isEditable ? '*' : ''}</label>
            <select className={sel} value={form.supplier_id ?? ''} disabled={!isEditable}
              onChange={e => setF('supplier_id', e.target.value)}>
              <option value="">— none —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Received By</label>
            <input className={inp} value={form.received_by ?? ''} disabled={!isEditable}
              onChange={e => setF('received_by', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Checked By</label>
            <input className={inp} value={form.checked_by ?? ''} disabled={!isEditable}
              onChange={e => setF('checked_by', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Harvested Heads</label>
            <input type="number" min={0} className={inp} value={form.harvested_heads ?? ''} disabled={!isEditable}
              onChange={e => setF('harvested_heads', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={lbl}>Start Time</label>
            <input type="time" className={inp} value={form.start_time ?? ''} disabled={!isEditable}
              onChange={e => setF('start_time', e.target.value)} />
          </div>

          {/* Row 3 */}
          <div>
            <label className={lbl}>Destination{isEditable ? '*' : ''}</label>
            <select className={sel} value={form.destination_id ?? ''} disabled={!isEditable}
              onChange={e => setF('destination_id', e.target.value)}>
              <option value="">— none —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Issued By</label>
            <input className={inp} value={form.issued_by ?? ''} disabled={!isEditable}
              onChange={e => setF('issued_by', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={lbl}>Remarks</label>
            <input className={inp} value={form.remarks ?? ''} disabled={!isEditable}
              onChange={e => setF('remarks', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>End Time</label>
            <input type="time" className={inp} value={form.end_time ?? ''} disabled={!isEditable}
              onChange={e => setF('end_time', e.target.value)} />
          </div>

          {/* Row 4 — Reject / Replacement / Delivery */}
          <div>
            <label className={lbl}>Reject (KGS)</label>
            <input type="number" min={0} step="any" className={inp} value={form.reject_kgs ?? ''} disabled={!isEditable}
              onChange={e => setF('reject_kgs', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={lbl}>Reject (Heads)</label>
            <input type="number" min={0} className={inp} value={form.reject_heads ?? ''} disabled={!isEditable}
              onChange={e => setF('reject_heads', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={lbl}>Replacement (KGS)</label>
            <input type="number" min={0} step="any" className={inp} value={form.replacement_kgs ?? ''} disabled={!isEditable}
              onChange={e => setF('replacement_kgs', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={lbl}>Replacement (Heads)</label>
            <input type="number" min={0} className={inp} value={form.replacement_heads ?? ''} disabled={!isEditable}
              onChange={e => setF('replacement_heads', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={lbl}>Delivery Method{isEditable ? '*' : ''}</label>
            <select className={sel} value={form.delivery_method ?? ''} disabled={!isEditable}
              onChange={e => setF('delivery_method', e.target.value)}>
              <option value="">— select —</option>
              {deliveryMethods.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              {/* keep existing value selectable if not in list */}
              {form.delivery_method && !deliveryMethods.find(d => d.name === form.delivery_method) && (
                <option value={form.delivery_method}>{form.delivery_method}</option>
              )}
            </select>
          </div>

          {/* Row 5 — Location / Building / Cost Center / Grow Reference */}
          <div>
            <label className={lbl}>Location</label>
            <select className={sel} value={form.branch_id ?? ''} disabled={!isEditable}
              onChange={e => setF('branch_id', e.target.value)}>
              <option value="">— none —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Building</label>
            <select className={sel} value={form.building_id ?? ''} disabled={!isEditable}
              onChange={e => setF('building_id', e.target.value)}>
              <option value="">— none —</option>
              {buildings.filter(b => !form.branch_id || !b.branch_id || b.branch_id === form.branch_id).map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Cost Center</label>
            <select className={sel} value={form.cost_center_id ?? ''} disabled={!isEditable}
              onChange={e => setF('cost_center_id', e.target.value)}>
              <option value="">— none —</option>
              {costCenters.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Grow Reference</label>
            <select className={sel} value={form.grow_reference_id ?? ''} disabled={!isEditable}
              onChange={e => setF('grow_reference_id', e.target.value)}>
              <option value="">— none —</option>
              {growRefs.map(g => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Plate / Driver</label>
            <div className="flex gap-1">
              <input className={inp} placeholder="Plate" value={form.plate_number ?? ''} disabled={!isEditable}
                onChange={e => setF('plate_number', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* Tally Details */}
      <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Tally Details</h2>
          {isEditable && (
            <button type="button" onClick={() => setLines(l => [...l, { line_no: l.length + 1, item_id: '', heads: 0, gross_kgs: 0, crate_kgs: 0, net_kgs: 0, remarks: '' }])}
              className="text-xs text-brand-600 hover:underline">+ Add line</button>
          )}
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
                {isEditable && <th className="w-6" />}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={isEditable ? 8 : 7} className="px-3 py-6 text-center text-slate-400">No data available in table</td></tr>
              ) : lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-1">
                    {isEditable ? (
                      <select value={l.item_id} onChange={e => updateLine(i, 'item_id', e.target.value)} className={tinp}>
                        <option value="">Select item…</option>
                        {items.map(it => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-slate-800 dark:text-slate-200">{l.sku} — {l.item_name}</span>
                    )}
                  </td>
                  <td className="px-3 py-1">
                    {isEditable ? (
                      <input type="number" min={0} value={l.heads} onChange={e => updateLine(i, 'heads', parseFloat(e.target.value) || 0)} className={`${tinp} text-right`} />
                    ) : (
                      <span className="block text-right font-mono">{Number(l.heads).toLocaleString()}</span>
                    )}
                  </td>
                  <td className="px-3 py-1">
                    {isEditable ? (
                      <input type="number" min={0} step="any" value={l.gross_kgs} onChange={e => updateLine(i, 'gross_kgs', parseFloat(e.target.value) || 0)} className={`${tinp} text-right`} />
                    ) : (
                      <span className="block text-right font-mono">{Number(l.gross_kgs).toFixed(2)}</span>
                    )}
                  </td>
                  <td className="px-3 py-1">
                    {isEditable ? (
                      <input type="number" min={0} step="any" value={l.crate_kgs} onChange={e => updateLine(i, 'crate_kgs', parseFloat(e.target.value) || 0)} className={`${tinp} text-right`} />
                    ) : (
                      <span className="block text-right font-mono">{Number(l.crate_kgs).toFixed(2)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{Number(l.net_kgs).toFixed(6)}</td>
                  <td className="px-3 py-1">
                    {isEditable ? (
                      <input type="text" value={l.remarks ?? ''} onChange={e => updateLine(i, 'remarks', e.target.value)} className={tinp} />
                    ) : (
                      <span className="text-slate-500">{l.remarks ?? '—'}</span>
                    )}
                  </td>
                  {isEditable && (
                    <td className="px-2 py-1 text-center">
                      {lines.length > 1 && (
                        <button onClick={() => setLines(l => l.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">×</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <td colSpan={2} className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{netHeads.toLocaleString()}</td>
                  <td colSpan={2} />
                  <td className="px-3 py-2 text-right font-mono font-semibold">{netKgs.toFixed(6)}</td>
                  <td colSpan={isEditable ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex gap-3">
          {isEditable && (
            <button onClick={save} disabled={saving}
              className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {doc.status === 'saved' && (
            <>
              <button onClick={() => action('post')} disabled={busy}
                className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                Post
              </button>
              <button onClick={() => action('void')} disabled={busy}
                className="rounded border border-red-300 px-5 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                Void
              </button>
            </>
          )}
          {isAdmin && (
            <button onClick={handleDelete} disabled={busy}
              className="rounded border border-red-300 bg-red-50 px-5 py-2 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-950 dark:text-red-400">
              Delete
            </button>
          )}
          {doc.status === 'posted' && (
            <button type="button"
              onClick={() => {
                sessionStorage.setItem('pending_conversion', JSON.stringify({
                  tally_sheet_id: doc.id,
                  transaction_date: (doc.transfer_date ?? '').split('T')[0],
                  branch_id: doc.destination_id ?? doc.branch_id ?? '',
                  lines: lines.map(l => ({
                    item_id: l.item_id,
                    item_name: l.item_name ?? '',
                    sku: l.sku ?? '',
                    heads: Number(l.heads),
                    net_kgs: Number(l.net_kgs),
                  })),
                }));
                router.push('/dashboard/poultry/conversions/new');
              }}
              className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Create Conversion
            </button>
          )}
        </div>
        <div className="flex gap-6 text-xs text-slate-500">
          <span>Net Heads: <strong className="text-slate-800 dark:text-slate-200">{netHeads.toLocaleString()}</strong></span>
          <span>Net KGS: <strong className="text-slate-800 dark:text-slate-200">{netKgs.toFixed(2)}</strong></span>
        </div>
      </div>
    </div>
  );
}
