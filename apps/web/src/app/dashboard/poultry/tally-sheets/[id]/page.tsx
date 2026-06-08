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
  live_item_id: string | null;
  je_id: string | null;
  transfer_je_id: string | null;
  dr_id: string | null;
  dr_no: string | null;
  conversion_id: string | null;
  conversion_no: string | null;
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
  const [showDRModal, setShowDRModal] = useState(false);
  const [drSoId, setDrSoId] = useState('');
  const [drOrders, setDrOrders] = useState<{ id: string; order_no: string; customer_name: string }[]>([]);
  const [creatingDR, setCreatingDR] = useState(false);
  const [drMsg, setDrMsg] = useState<string | null>(null);

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferPrice, setTransferPrice] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMsg, setTransferMsg] = useState<string | null>(null);

  // Reference data
  const [suppliers, setSuppliers]   = useState<Supplier[]>([]);
  const [branches, setBranches]     = useState<Branch[]>([]);
  const [items, setItems]           = useState<Item[]>([]);
  const [growRefs, setGrowRefs]     = useState<GrowRef[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [buildings, setBuildings]         = useState<Building[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<DeliveryMethod[]>([]);

  const today = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
  const load = useCallback(() => {
    api.get<TallySheet>(`/poultry/tally-sheets/${id}`).then(d => {
      setDoc(d);
      const rawDate = d.transfer_date ? String(d.transfer_date).substring(0, 10) : '';
      setForm({ ...d, transfer_date: rawDate || today });
      const loadedLines = d.lines.map(l => ({ ...l }));
      if (loadedLines.length === 0 && d.status === 'saved' && d.harvested_heads > 0) {
        setLines([{
          line_no: 1,
          item_id: d.live_item_id ?? '',
          heads: d.harvested_heads,
          gross_kgs: 0,
          crate_kgs: 0,
          net_kgs: 0,
          remarks: '',
        }]);
      } else {
        setLines(loadedLines);
      }
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
      // In simplified mode, editing net_kgs directly (via gross_kgs field) also sets gross_kgs
      if (field === 'gross_kgs' && line.crate_kgs === 0) {
        line.net_kgs = Number(value);
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
    try {
      // Always persist latest form + lines before any state transition
      await api.patch(`/poultry/tally-sheets/${id}`, { ...form, lines });
      await api.post(`/poultry/tally-sheets/${id}/${act}`, {});
      load();
    }
    catch (e: unknown) { setMsg({ text: (e as Error).message, type: 'error' }); }
    finally { setBusy(false); }
  }

  async function openDRModal() {
    setDrMsg(null); setDrSoId(''); setShowDRModal(true);
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<{ data: { id: string; order_no: string; customer_name: string }[] }>(
      `/sales/orders?company_id=${cid}&status=approved&status=partially_delivered&limit=200`)
      .then(r => setDrOrders(r.data ?? [])).catch(() => {});
  }

  async function createDR() {
    if (!drSoId) { setDrMsg('Select a sales order'); return; }
    setCreatingDR(true); setDrMsg(null);
    try {
      const res = await api.post<{ dr_id: string; dr_no: string }>(`/poultry/tally-sheets/${id}/create-dr`, { so_id: drSoId });
      setShowDRModal(false);
      router.push(`/dashboard/sales/delivery-receipts/${res.dr_id}`);
    } catch (e: unknown) { setDrMsg((e as Error).message ?? 'Failed to create DR'); }
    finally { setCreatingDR(false); }
  }

  function openTransferModal() {
    setTransferMsg(null);
    setTransferPrice('');
    setShowTransferModal(true);
  }

  async function postTransferJE() {
    const price = parseFloat(transferPrice);
    if (!price || price <= 0) { setTransferMsg('Enter a valid transfer price'); return; }
    setTransferBusy(true); setTransferMsg(null);
    try {
      await api.post(`/poultry/tally-sheets/${id}/create-transfer-je`, { transfer_price: price });
      setShowTransferModal(false);
      sessionStorage.setItem('pending_conversion', JSON.stringify({
        tally_sheet_id: doc!.id,
        transaction_date: (doc!.transfer_date ?? '').split('T')[0],
        branch_id: doc!.destination_id ?? doc!.branch_id ?? '',
        lines: lines.map(l => ({
          item_id: l.item_id,
          item_name: l.item_name ?? '',
          sku: l.sku ?? '',
          heads: Number(l.heads),
          net_kgs: Number(l.net_kgs),
        })),
      }));
      router.push('/dashboard/poultry/conversions/new');
    } catch (e: unknown) { setTransferMsg((e as Error).message ?? 'Failed'); }
    finally { setTransferBusy(false); }
  }

  const netKgs      = lines.reduce((s, l) => s + Number(l.net_kgs), 0);
  const netHeads    = lines.reduce((s, l) => s + Number(l.heads), 0);
  const avgWeight   = netHeads > 0 ? netKgs / netHeads : 0;
  const harvestedHeads = Number(doc?.harvested_heads ?? 0);
  const availHeads  = harvestedHeads - netHeads;

  const [entryHeads, setEntryHeads] = useState(0);
  const [entryKgs,   setEntryKgs]   = useState(0);
  const [entryRef,   setEntryRef]   = useState('');
  const [editIdx,    setEditIdx]    = useState<number | null>(null);

  function addTallyLine() {
    if (entryHeads <= 0 && entryKgs <= 0) return;
    setLines(prev => [...prev, {
      line_no: prev.length + 1,
      item_id: doc?.live_item_id ?? (items[0]?.id ?? ''),
      heads:     entryHeads,
      gross_kgs: entryKgs,
      crate_kgs: 0,
      net_kgs:   entryKgs,
      remarks:   entryRef,
    }]);
    setEntryHeads(0);
    setEntryKgs(0);
    setEntryRef('');
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  if (!doc) return <div className="py-12 text-center text-sm text-red-500">Not found.</div>;

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">View Tally Sheet</h1>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/poultry/tally-sheets/${id}/print`}
            target="_blank"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            🖨 Print
          </Link>
          <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-xl leading-none">←</button>
        </div>
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
        <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Tally Details</h2>
        </div>

        {/* Entry area: LEFT = tally inputs + totals | RIGHT = available */}
        <div className="border-b border-slate-100 dark:border-slate-700 grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700">
          {/* LEFT — entry & running totals */}
          <div className="bg-slate-50 dark:bg-slate-800 px-6 py-4">
            <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Tally Entry</div>
            {isEditable && (
              <div className="flex flex-wrap items-end gap-3 mb-4">
                <div>
                  <label className={lbl}>Heads</label>
                  <input type="number" min={0} value={entryHeads || ''}
                    onChange={e => setEntryHeads(parseFloat(e.target.value) || 0)}
                    onKeyDown={e => e.key === 'Enter' && addTallyLine()}
                    placeholder="0"
                    className="w-24 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-right dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
                </div>
                <div>
                  <label className={lbl}>Quantity (KGS)</label>
                  <input type="number" min={0} step="any" value={entryKgs || ''}
                    onChange={e => setEntryKgs(parseFloat(e.target.value) || 0)}
                    onKeyDown={e => e.key === 'Enter' && addTallyLine()}
                    placeholder="0.000000"
                    className="w-36 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-right dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
                </div>
                <div className="flex-1 min-w-28">
                  <label className={lbl}>Reference</label>
                  <input type="text" value={entryRef}
                    onChange={e => setEntryRef(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTallyLine()}
                    placeholder="reference…"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
                </div>
                <button type="button" onClick={addTallyLine}
                  className="rounded bg-brand-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-700">
                  +
                </button>
              </div>
            )}
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Total Heads</div>
                <div className="mt-0.5 text-lg font-bold text-slate-800 dark:text-slate-100">{netHeads.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Total Quantity (KGS)</div>
                <div className="mt-0.5 text-lg font-bold text-slate-800 dark:text-slate-100">{netKgs.toFixed(6)}</div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Average Weight (KGS)</div>
                <div className="mt-0.5 text-lg font-bold text-slate-800 dark:text-slate-100">{avgWeight.toFixed(6)}</div>
              </div>
            </div>
          </div>

          {/* RIGHT — available for tally */}
          <div className="px-6 py-4 flex flex-col justify-center">
            <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Available for Tally</div>
            {harvestedHeads > 0 ? (
              <>
                <div className="mb-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Harvested Heads</div>
                  <div className="text-sm font-medium text-slate-600 dark:text-slate-300">{harvestedHeads.toLocaleString()}</div>
                </div>
                <div className={`text-4xl font-bold ${availHeads <= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {Math.max(0, availHeads).toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">heads remaining</div>
                {availHeads <= 0 && (
                  <div className="mt-2 text-xs font-medium text-emerald-600">✓ All heads tallied</div>
                )}
                {harvestedHeads > 0 && (
                  <div className="mt-3 h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700">
                    <div
                      className="h-2 rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.min(100, (netHeads / harvestedHeads) * 100).toFixed(1)}%` }}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-slate-400 italic">No harvest target set on this tally</div>
            )}
          </div>
        </div>

        {/* Lines table */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium w-16">Line #</th>
                <th className="px-4 py-2 text-right font-medium w-32">Heads</th>
                <th className="px-4 py-2 text-right font-medium w-40">Quantity (KGS)</th>
                <th className="px-4 py-2 text-left font-medium">Reference</th>
                <th className="px-4 py-2 text-center font-medium w-20">Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">No data available in table</td>
                </tr>
              ) : lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {editIdx === i && isEditable ? (
                      <input type="number" min={0} value={l.heads}
                        onChange={e => updateLine(i, 'heads', parseFloat(e.target.value) || 0)}
                        className={`${tinp} text-right w-24`} />
                    ) : Number(l.heads).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {editIdx === i && isEditable ? (
                      <input type="number" min={0} step="any" value={l.net_kgs}
                        onChange={e => updateLine(i, 'gross_kgs', parseFloat(e.target.value) || 0)}
                        className={`${tinp} text-right w-28`} />
                    ) : Number(l.net_kgs).toFixed(6)}
                  </td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                    {editIdx === i && isEditable ? (
                      <input type="text" value={l.remarks ?? ''}
                        onChange={e => updateLine(i, 'remarks', e.target.value)}
                        className={tinp} />
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {l.remarks && <span>{l.remarks}</span>}
                        {doc.dr_id && doc.dr_no && (
                          <Link href={`/dashboard/sales/delivery-receipts/${doc.dr_id}`}
                            className="text-brand-700 hover:underline dark:text-brand-400 font-medium">
                            {doc.dr_no}
                          </Link>
                        )}
                        {doc.conversion_id && doc.conversion_no && (
                          <Link href={`/dashboard/poultry/conversions/${doc.conversion_id}`}
                            className="text-brand-700 hover:underline dark:text-brand-400 font-medium">
                            {doc.conversion_no}
                          </Link>
                        )}
                        {!l.remarks && !doc.dr_id && !doc.conversion_id && '—'}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {isEditable && (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setEditIdx(editIdx === i ? null : i)}
                          className="text-slate-400 hover:text-brand-600"
                          title="Edit line">
                          {editIdx === i ? '✓' : '✏'}
                        </button>
                        <button
                          onClick={() => { setLines(prev => prev.filter((_, j) => j !== i)); if (editIdx === i) setEditIdx(null); }}
                          className="text-red-400 hover:text-red-600"
                          title="Delete line">
                          ×
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
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
          {doc.je_id && (
            <Link href={`/dashboard/gl/journal-entries/${doc.je_id}`}
              className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              View Journal Entry
            </Link>
          )}
          {doc.status === 'posted' && !doc.je_id && (
            <button onClick={async () => {
              setBusy(true); setMsg(null);
              try {
                await api.post(`/poultry/tally-sheets/${id}/create-je`, {});
                load();
              } catch (e: unknown) { setMsg({ text: (e as Error).message, type: 'error' }); }
              finally { setBusy(false); }
            }} disabled={busy}
              className="rounded border border-amber-400 bg-amber-50 px-5 py-2 text-sm text-amber-800 hover:bg-amber-100 disabled:opacity-50">
              Create Journal Entry
            </button>
          )}
          {doc.status === 'posted' && (
            <>
              <button type="button" onClick={openTransferModal}
                className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Create Conversion
              </button>
              {doc.transfer_je_id && (
                <Link href={`/dashboard/gl/journal-entries/${doc.transfer_je_id}`}
                  className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                  View Transfer JE
                </Link>
              )}
              <button type="button" onClick={openDRModal}
                className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                Create DR
              </button>
            </>
          )}
        </div>
        <div className="flex gap-6 text-xs text-slate-500">
          <span>Net Heads: <strong className="text-slate-800 dark:text-slate-200">{netHeads.toLocaleString()}</strong></span>
          <span>Net KGS: <strong className="text-slate-800 dark:text-slate-200">{netKgs.toFixed(2)}</strong></span>
        </div>
      </div>

      {/* Transfer JE modal */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[500px] rounded-lg bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">Post Transfer Journal Entry</h2>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              A transfer JE will be posted to record the movement of live chickens to the trading location before creating the item conversion.
            </p>

            <div className="mb-4 overflow-hidden rounded border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Account</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">Debit</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  <tr>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">Cos - Live</td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">Live cost</td>
                    <td className="px-3 py-2 text-right"></td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">Invty Live</td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">Transfer price</td>
                    <td className="px-3 py-2 text-right"></td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">Invty Live</td>
                    <td className="px-3 py-2 text-right"></td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">Live cost</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">Sales - Live</td>
                    <td className="px-3 py-2 text-right"></td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">Transfer price</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Transfer Price (₱) *</label>
              <input
                type="number" min="0" step="0.01"
                value={transferPrice}
                onChange={e => setTransferPrice(e.target.value)}
                placeholder="0.00"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            {transferMsg && (
              <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{transferMsg}</div>
            )}

            <div className="flex gap-3">
              <button onClick={postTransferJE} disabled={transferBusy || !transferPrice}
                className="flex-1 rounded bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {transferBusy ? 'Posting…' : 'Post JE & Create Conversion'}
              </button>
              <button onClick={() => setShowTransferModal(false)} disabled={transferBusy}
                className="flex-1 rounded border border-slate-300 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create DR modal */}
      {showDRModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[460px] rounded-lg bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">Create Delivery Receipt</h2>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Select the Sales Order to fulfill with this tally's quantities ({netKgs.toFixed(2)} KGS / {netHeads.toLocaleString()} heads).
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Sales Order *</label>
              <select value={drSoId} onChange={e => setDrSoId(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select sales order…</option>
                {drOrders.map(o => (
                  <option key={o.id} value={o.id}>{o.order_no} — {o.customer_name}</option>
                ))}
              </select>
            </div>
            {drMsg && (
              <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{drMsg}</div>
            )}
            <div className="flex gap-3">
              <button onClick={createDR} disabled={creatingDR || !drSoId}
                className="flex-1 rounded bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {creatingDR ? 'Creating…' : 'Create DR'}
              </button>
              <button onClick={() => setShowDRModal(false)}
                className="flex-1 rounded border border-slate-300 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
