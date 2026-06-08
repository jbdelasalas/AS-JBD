'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate, formatPHP } from '@/lib/format';

interface Cycle {
  id: string; doc_no: string; status: string; year: number;
  start_date: string; expected_end_date: string | null; actual_end_date: string | null;
  heads_in: number; heads_available: number; total_mortality: number; heads_harvested: number;
  est_harvest_recovery: number | null; grow_reference: string | null;
  approx_heads: number; chick_price_per_head: number; approx_chick_price_per_head: number;
  culling_qty: number; remarks: string | null;
  item_id: string; item_name: string; sku: string; batch_no: string;
  live_item_id: string | null; live_item_name: string | null; live_item_sku: string | null;
  branch_id: string | null; building_id: string | null; cost_center_id: string | null;
  building_name: string | null; building_code: string | null;
  branch_name: string | null; branch_code: string | null;
  cost_center_name: string | null; cost_center_code: string | null;
  daily_mortality: Array<{ day_no: number; qty: number }>;
  weekly_weights: Array<{ week_no: number; weight_kg: number }>;
  item_consumption: Array<{ id: string; line_no: number; item_id: string; item_name: string; sku: string; quantity: number; uom: string; unit_cost: number; total_cost: number; remarks: string | null }>;
}

interface AllItem { id: string; sku: string; name: string; uom: string; }

interface Building { id: string; code: string; name: string; branch_id: string | null; }
interface Branch { id: string; code: string; name: string; }
interface GrowRef { id: string; code: string; name: string; }
interface CostCenter { id: string; code: string; name: string; }
interface Uom { id: string; code: string; name: string; }
interface TallySheet {
  id: string; doc_no: string; status: string; transfer_date: string;
  harvested_heads: number; net_heads: number; net_kgs: number;
  received_by: string | null; created_at: string;
}

interface Item { id: string; sku: string; name: string; uom: string; qty_on_hand: number; avg_cost: number; }

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100">{value ?? <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

const DAYS = Array.from({ length: 35 }, (_, i) => i + 1);
const WEEKS = [0, 7, 14, 21, 25, 32];
const STATUS_COLORS: Record<string, string> = { active: 'bg-emerald-100 text-emerald-700', harvesting: 'bg-amber-100 text-amber-700', completed: 'bg-blue-100 text-blue-700', closed: 'bg-slate-100 text-slate-600' };

export default function GrowCycleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<Cycle | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [allItems, setAllItems] = useState<AllItem[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [growRefs, setGrowRefs] = useState<GrowRef[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<'error' | 'success'>('error');
  const [isAdmin, setIsAdmin] = useState(false);

  // Harvest panel state
  const [showHarvest, setShowHarvest] = useState(false);
  const [harvestHeads, setHarvestHeads] = useState('');
  const [tallySheets, setTallySheets] = useState<TallySheet[]>([]);
  const [harvesting, setHarvesting] = useState(false);
  const [harvestError, setHarvestError] = useState<string | null>(null);

  // Header edit state
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerForm, setHeaderForm] = useState({
    branch_id: '', building_id: '', grow_reference: '', cost_center_id: '',
    start_date: '', expected_end_date: '', live_item_id: '', remarks: '',
  });

  // Operations edit state
  const [dailyMortality, setDailyMortality] = useState<Record<number, string>>({});
  const [culling, setCulling] = useState('');
  const [weeklyWeights, setWeeklyWeights] = useState<Record<number, string>>({});
  const [consumption, setConsumption] = useState<Array<{ item_id: string; quantity: string; uom: string; unit_cost: string; remarks: string }>>([]);

  const load = useCallback(() => {
    api.get<Cycle>(`/poultry/grow-cycles/${id}`).then(d => {
      setDoc(d);
      setHeaderForm({
        branch_id: d.branch_id ?? '',
        building_id: d.building_id ?? '',
        grow_reference: d.grow_reference ?? '',
        cost_center_id: d.cost_center_id ?? '',
        start_date: d.start_date ?? '',
        expected_end_date: d.expected_end_date ?? '',
        live_item_id: d.live_item_id ?? '',
        remarks: d.remarks ?? '',
      });
      // Populate operations edit states
      const dm: Record<number, string> = {};
      (d.daily_mortality ?? []).forEach(m => { dm[m.day_no] = String(m.qty || ''); });
      setDailyMortality(dm);
      setCulling(d.culling_qty > 0 ? String(d.culling_qty) : '');
      const ww: Record<number, string> = {};
      (d.weekly_weights ?? []).forEach(w => { ww[w.week_no] = String(w.weight_kg || ''); });
      setWeeklyWeights(ww);
      setConsumption((d.item_consumption ?? []).map(c => ({
        item_id: c.item_id, quantity: String(c.quantity), uom: c.uom, unit_cost: String(c.unit_cost), remarks: c.remarks ?? '',
      })));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    try { const u = JSON.parse(localStorage.getItem('user') ?? 'null'); setIsAdmin(u?.is_superadmin === true); } catch {}
  }, []);

  async function handleDelete() {
    if (!window.confirm('Delete this grow cycle? This cannot be undone.')) return;
    setSaving(true); setMsg(null);
    try { await api.delete(`/poultry/grow-cycles/${id}`); router.push('/dashboard/poultry/grow-cycles'); }
    catch (e: unknown) { setMsg((e as Error).message ?? 'Delete failed'); setMsgType('error'); setSaving(false); }
  }

  // Load reference data for dropdowns independently of the cycle reload
  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    api.get<Item[]>(`/poultry/grow-cycles/${id}/consumable-items`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<AllItem[]>(`/inventory/items?company_id=${cid}&minimal=true`).then(r => {
      const arr = Array.isArray(r) ? r : [];
      setAllItems(arr);
      // If no harvest item set yet, default to first item with "live" in name
      const liveItem = arr.find(i => /live/i.test(i.name) || /live/i.test(i.sku));
      if (liveItem) {
        setHeaderForm(f => ({ ...f, live_item_id: f.live_item_id || liveItem.id }));
      }
    }).catch(() => {});
    api.get<Branch[]>(`/admin/branches?company_id=${cid}`).then(r => setBranches(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Building[]>(`/poultry/buildings?company_id=${cid}`).then(r => setBuildings(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<GrowRef[]>(`/poultry/grow-references?company_id=${cid}`).then(r => setGrowRefs(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<CostCenter[]>(`/admin/cost-centers?company_id=${cid}&limit=100`).then(r => setCostCenters(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<Uom[]>(`/admin/uoms?company_id=${cid}`).then(r => setUoms(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  function openHarvest() {
    setShowHarvest(true);
    setHarvestHeads(String(doc?.heads_available ?? ''));
    setHarvestError(null);
    const cid = localStorage.getItem('company_id');
    if (cid) {
      api.get<{ data: TallySheet[] }>(`/poultry/tally-sheets?company_id=${cid}&grow_cycle_id=${id}&limit=50`)
        .then(r => setTallySheets(r.data ?? [])).catch(() => {});
    }
  }

  async function executeHarvest() {
    const heads = parseInt(harvestHeads) || 0;
    if (heads <= 0) { setHarvestError('Enter a valid number of heads'); return; }
    if (!doc) return;
    setHarvesting(true); setHarvestError(null);
    try {
      const cid = localStorage.getItem('company_id')!;
      const today = new Date().toISOString().split('T')[0];
      if (!doc.live_item_id) {
        setHarvestError('Harvest item (live chicken) is not set on this grow cycle. Click Edit Header to configure it.');
        setHarvesting(false);
        return;
      }
      const ts = await api.post<{ id: string }>('/poultry/tally-sheets', {
        company_id:        cid,
        grow_cycle_id:     id,
        tally_type:        'harvest',
        transfer_date:     today,
        harvested_heads:   heads,
        destination_id:    doc.branch_id    || null,
        branch_id:         doc.branch_id    || null,
        building_id:       doc.building_id  || null,
        cost_center_id:    doc.cost_center_id || null,
        remarks:           `Generated from growing ${doc.doc_no}`,
        lines: [{
          item_id:   doc.live_item_id,   // live chicken, not DOC
          heads,
          gross_kgs: 0,
          crate_kgs: 0,
          net_kgs:   0,
        }],
      });
      router.push(`/dashboard/poultry/tally-sheets/${ts.id}`);
    } catch (e: unknown) {
      setHarvestError((e as Error).message ?? 'Failed to create tally sheet');
    } finally {
      setHarvesting(false);
    }
  }

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const dm = DAYS.map(d => ({ day_no: d, qty: parseFloat(dailyMortality[d] || '0') || 0 })).filter(d => d.qty > 0);
      const ww = WEEKS.map(w => ({ week_no: w, weight_kg: parseFloat(weeklyWeights[w] || '0') || 0 }));
      const cons = consumption.filter(c => c.item_id).map(c => ({
        item_id: c.item_id, quantity: parseFloat(c.quantity) || 0, uom: c.uom,
        unit_cost: parseFloat(c.unit_cost) || 0, remarks: c.remarks || undefined,
      }));
      await api.patch(`/poultry/grow-cycles/${id}`, {
        ...(editingHeader ? {
          branch_id:         headerForm.branch_id || null,
          building_id:       headerForm.building_id || null,
          grow_reference:    headerForm.grow_reference || null,
          cost_center_id:    headerForm.cost_center_id || null,
          start_date:        headerForm.start_date || null,
          expected_end_date: headerForm.expected_end_date || null,
          live_item_id:      headerForm.live_item_id || null,
          remarks:           headerForm.remarks || null,
        } : {}),
        culling_qty: parseFloat(culling) || 0,
        approx_chick_price_per_head: approxChickPricePerHead,
        daily_mortality: dm,
        weekly_weights: ww,
        item_consumption: cons,
      });
      setMsg('Saved successfully'); setMsgType('success');
      setEditingHeader(false);
      load();
      // Refresh consumable items in case location/building changed
      api.get<Item[]>(`/poultry/grow-cycles/${id}/consumable-items`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    } catch (e: unknown) { setMsg((e as Error).message); setMsgType('error'); } finally { setSaving(false); }
  }

  async function complete() {
    setSaving(true); setMsg(null);
    try { await api.post(`/poultry/grow-cycles/${id}/complete`, {}); load(); }
    catch (e: unknown) { setMsg((e as Error).message); setMsgType('error'); } finally { setSaving(false); }
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  if (!doc) return <div className="py-12 text-center text-sm text-red-500">Not found.</div>;

  const isEditable = doc.status === 'active' || doc.status === 'harvesting';
  const totalDailyMortality = DAYS.reduce((s, d) => s + (parseFloat(dailyMortality[d] || '0') || 0), 0);
  const totalMortalityWithCulling = totalDailyMortality + (parseFloat(culling) || 0);
  const totalConsumptionCost = consumption.reduce((s, c) => s + (parseFloat(c.quantity) || 0) * (parseFloat(c.unit_cost) || 0), 0);
  const chickPrice = Number(doc.chick_price_per_head) || 0;
  const headsAvailable = Number(doc.heads_available) || 0;
  const approxChickPricePerHead = headsAvailable > 0
    ? chickPrice + totalConsumptionCost / headsAvailable
    : chickPrice;

  return (
    <div className="space-y-0">
      {/* Page header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">View Growing</h1>
        </div>
        <div className="flex items-center gap-2">
          {isEditable && (
            <>
              <button onClick={save} disabled={saving}
                className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              {!editingHeader ? (
                <button onClick={() => setEditingHeader(true)}
                  className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                  Edit Header
                </button>
              ) : (
                <button onClick={() => { setEditingHeader(false); setHeaderForm({ branch_id: doc.branch_id ?? '', building_id: doc.building_id ?? '', grow_reference: doc.grow_reference ?? '', cost_center_id: doc.cost_center_id ?? '', start_date: doc.start_date ?? '', expected_end_date: doc.expected_end_date ?? '', live_item_id: doc.live_item_id ?? '', remarks: doc.remarks ?? '' }); }}
                  className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-600">
                  Cancel Edit
                </button>
              )}
              <button onClick={openHarvest}
                className="rounded border border-brand-300 px-4 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-400">
                Harvest
              </button>
              <button onClick={complete} disabled={saving}
                className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Mark Completed
              </button>
            </>
          )}
          {isAdmin && (
            <button onClick={handleDelete} disabled={saving}
              className="rounded border border-red-300 bg-red-50 px-4 py-1.5 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-950 dark:text-red-400">
              Delete
            </button>
          )}
          <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-lg leading-none">←</button>
        </div>
      </div>

      {msg && (
        <div className={`mb-4 rounded border px-3 py-2 text-sm ${msgType === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg}</div>
      )}

      {/* Header card */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
        {editingHeader && <div className="mb-4 text-xs font-medium text-brand-600 dark:text-brand-400">Editing header — click Save to apply changes</div>}
        <div className="grid grid-cols-4 gap-x-8 gap-y-5 text-sm">

          {/* Fixed / read-only fields */}
          <Field label="Transaction Number" value={<span className="font-mono">{doc.doc_no}</span>} />
          <Field label="Status" value={<span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[doc.status] ?? 'bg-slate-100 text-slate-600'}`}>{doc.status}</span>} />
          <Field label="Year" value={doc.year} />
          <Field label="Chick Batch" value={`${doc.item_name} ${doc.batch_no}`} />
          <Field label="Heads" value={<span className="font-semibold">{Number(doc.heads_in).toLocaleString()}</span>} />
          <Field label="Available / Harvested" value={<span className="text-emerald-600 font-semibold">{Number(doc.heads_available).toLocaleString()} / {Number(doc.heads_harvested).toLocaleString()}</span>} />
          <Field label="Chick Price/Head" value={Number(doc.chick_price_per_head).toFixed(6)} />
          <Field label="Approx Chick Price/Head" value={approxChickPricePerHead != null ? Number(approxChickPricePerHead).toFixed(6) : '—'} />
          <Field label="Est. Harvest Recovery" value={doc.est_harvest_recovery != null ? Number(doc.est_harvest_recovery).toFixed(2) : <span className="text-red-500">—</span>} />

          {/* Editable fields */}
          {editingHeader ? (
            <>
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Location *</label>
                <select required value={headerForm.branch_id} onChange={e => setHeaderForm(f => ({ ...f, branch_id: e.target.value, building_id: '' }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="">Select location…</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Building *</label>
                <select required value={headerForm.building_id} onChange={e => setHeaderForm(f => ({ ...f, building_id: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="">Select building…</option>
                  {buildings.filter(b => !headerForm.branch_id || !b.branch_id || b.branch_id === headerForm.branch_id).map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Grow Reference *</label>
                <select required value={headerForm.grow_reference} onChange={e => setHeaderForm(f => ({ ...f, grow_reference: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="">— select —</option>
                  {growRefs.map(g => <option key={g.id} value={g.name}>{g.code} — {g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Cost Center *</label>
                <select required value={headerForm.cost_center_id} onChange={e => setHeaderForm(f => ({ ...f, cost_center_id: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="">— select —</option>
                  {costCenters.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Start Date</label>
                <input type="date" value={headerForm.start_date} onChange={e => setHeaderForm(f => ({ ...f, start_date: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">End Date</label>
                <input type="date" value={headerForm.expected_end_date} onChange={e => setHeaderForm(f => ({ ...f, expected_end_date: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Harvest Item (Live Chicken)</label>
                <select value={headerForm.live_item_id} onChange={e => setHeaderForm(f => ({ ...f, live_item_id: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="">— select live chicken item —</option>
                  {allItems.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Remarks</label>
                <input type="text" value={headerForm.remarks} onChange={e => setHeaderForm(f => ({ ...f, remarks: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </div>
            </>
          ) : (
            <>
              <div className="col-span-2"><Field label="Location" value={doc.branch_name ? `${doc.branch_code} — ${doc.branch_name}` : null} /></div>
              <Field label="Building" value={doc.building_name ? `${doc.building_code} — ${doc.building_name}` : null} />
              <Field label="Grow Reference" value={doc.grow_reference} />
              <Field label="Cost Center" value={doc.cost_center_name ? `${doc.cost_center_code} — ${doc.cost_center_name}` : null} />
              <Field label="Start Date" value={formatDate(doc.start_date)} />
              <Field label="End Date" value={doc.expected_end_date ? formatDate(doc.expected_end_date) : null} />
              <div className="col-span-2">
                <Field label="Harvest Item (Live Chicken)"
                  value={doc.live_item_name
                    ? <span className="font-medium text-emerald-700 dark:text-emerald-400">{doc.live_item_sku} — {doc.live_item_name}</span>
                    : <span className="text-amber-600 text-xs">Not set — click Edit Header to configure</span>}
                />
              </div>
              <div className="col-span-2"><Field label="Remarks" value={doc.remarks} /></div>
            </>
          )}
        </div>
      </div>

      {/* Partial Harvest Panel */}
      {showHarvest && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-slate-900 p-6">
          <div className="mb-4 text-base font-semibold text-slate-800 dark:text-slate-100">Partial Harvest</div>
          <div className="mb-5 h-px bg-slate-200 dark:bg-slate-700" />

          <div className="mb-6 grid grid-cols-2 gap-6 max-w-sm">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Remaining Heads *</label>
              <div className="border-b border-slate-300 py-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {Number(doc.heads_available).toLocaleString()}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Heads *</label>
              <input
                type="number" min={1} max={doc.heads_available} step={1}
                value={harvestHeads}
                onChange={e => setHarvestHeads(e.target.value)}
                className="w-full border-b border-slate-300 bg-transparent py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Tally Sheet History */}
          <table className="min-w-full text-xs mb-6">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Tally Sheet ID</th>
                <th className="px-3 py-2 text-right font-medium">Heads</th>
                <th className="px-3 py-2 text-right font-medium">Actual Heads</th>
                <th className="px-3 py-2 text-right font-medium">Net KGS</th>
                <th className="px-3 py-2 text-left font-medium">Harvest Date</th>
                <th className="px-3 py-2 text-left font-medium">Harvest By</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {tallySheets.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400">No harvest tally sheets yet</td></tr>
              ) : tallySheets.map(ts => (
                <tr key={ts.id} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 font-mono text-brand-700 dark:text-brand-400">{ts.doc_no}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(ts.harvested_heads).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(ts.net_heads).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(ts.net_kgs).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDate(ts.transfer_date)}</td>
                  <td className="px-3 py-2 text-slate-500">{ts.received_by ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ts.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : ts.status === 'voided' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                      {ts.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {harvestError && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {harvestError}
            </div>
          )}
          <div className="flex justify-end gap-4">
            <button onClick={() => { setShowHarvest(false); setHarvestError(null); }}
              className="px-4 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 uppercase tracking-wide">
              Cancel
            </button>
            <button onClick={executeHarvest} disabled={harvesting}
              className="px-4 py-1.5 text-sm font-semibold text-brand-600 hover:text-brand-800 dark:text-brand-400 disabled:opacity-50 uppercase tracking-wide">
              {harvesting ? 'Creating…' : 'Harvest'}
            </button>
          </div>
        </div>
      )}

      {/* Daily Mortality Heads */}
      <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3">
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Daily Mortality Heads</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-6 gap-x-8 gap-y-4">
            {/* Column 1: Day 1-6 + Culling */}
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(d => (
                <div key={d}>
                  <label className="block text-xs text-brand-600 dark:text-brand-400 mb-0.5">Day {d} Qty</label>
                  <input type="number" min={0} value={dailyMortality[d] ?? ''} placeholder="0"
                    onChange={e => setDailyMortality(prev => ({ ...prev, [d]: e.target.value }))}
                    disabled={!isEditable}
                    className="w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none disabled:text-slate-400" />
                </div>
              ))}
              <div>
                <label className="block text-xs text-brand-600 dark:text-brand-400 mb-0.5">Culling Qty</label>
                <input type="number" min={0} value={culling} placeholder="0"
                  onChange={e => setCulling(e.target.value)}
                  disabled={!isEditable}
                  className="w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none disabled:text-slate-400" />
              </div>
              <div>
                <label className="block text-xs text-brand-600 dark:text-brand-400 mb-0.5">Day 6 Qty</label>
                <input type="number" min={0} value={dailyMortality[6] ?? ''} placeholder="0"
                  onChange={e => setDailyMortality(prev => ({ ...prev, 6: e.target.value }))}
                  disabled={!isEditable}
                  className="w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none disabled:text-slate-400" />
              </div>
            </div>

            {/* Columns 2-6: Days 7-35 in groups of 6 */}
            {[
              [7, 8, 9, 10, 11, 12],
              [13, 14, 15, 16, 17, 18],
              [19, 20, 21, 22, 23, 24],
              [25, 26, 27, 28, 29, 30],
              [31, 32, 33, 34, 35],
            ].map((group, gi) => (
              <div key={gi} className="space-y-3">
                {group.map(d => (
                  <div key={d}>
                    <label className="block text-xs text-brand-600 dark:text-brand-400 mb-0.5">Day {d} Qty</label>
                    <input type="number" min={0} value={dailyMortality[d] ?? ''} placeholder="0"
                      onChange={e => setDailyMortality(prev => ({ ...prev, [d]: e.target.value }))}
                      disabled={!isEditable}
                      className="w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none disabled:text-slate-400" />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Mortality summary */}
          <div className="mt-4 flex gap-6 text-xs text-slate-500 border-t border-slate-100 dark:border-slate-700 pt-3">
            <span>Total Daily: <strong className="text-red-500">{totalDailyMortality.toLocaleString()}</strong></span>
            <span>Culling: <strong className="text-amber-600">{(parseFloat(culling) || 0).toLocaleString()}</strong></span>
            <span>Total Mortality: <strong className="text-red-600">{totalMortalityWithCulling.toLocaleString()}</strong></span>
            <span>Mortality Rate: <strong className="text-slate-700 dark:text-slate-300">
              {Number(doc.heads_in) > 0 ? ((totalMortalityWithCulling / Number(doc.heads_in)) * 100).toFixed(2) : '0.00'}%
            </strong></span>
          </div>
        </div>
      </div>

      {/* Weekly Weight */}
      <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3">
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Weekly Weight</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-3 gap-x-16 gap-y-4">
            {WEEKS.map(w => (
              <div key={w}>
                <label className="block text-xs text-brand-600 dark:text-brand-400 mb-0.5">Week {w} Weigh (kgs)</label>
                <input type="number" min={0} step="0.0001" value={weeklyWeights[w] ?? ''} placeholder="0.0000"
                  onChange={e => setWeeklyWeights(prev => ({ ...prev, [w]: e.target.value }))}
                  disabled={!isEditable}
                  className="w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none disabled:text-slate-400" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Available Inventory */}
      <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Available Inventory</h2>
          <span className="text-xs text-slate-400">Filtered by location, building &amp; grow reference</span>
        </div>
        {items.length === 0 ? (
          <div className="px-6 py-4 text-xs text-slate-400">No inventory found for this location / building / grow reference.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">SKU</th>
                  <th className="px-4 py-2 text-left font-medium">Item</th>
                  <th className="px-4 py-2 text-left font-medium w-16">UOM</th>
                  <th className="px-4 py-2 text-right font-medium w-28">On Hand</th>
                  <th className="px-4 py-2 text-right font-medium w-28">Avg Cost</th>
                  <th className="px-4 py-2 text-right font-medium w-28">Stock Value</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                    <td className="px-4 py-2 font-mono text-slate-500 dark:text-slate-400">{it.sku}</td>
                    <td className="px-4 py-2 dark:text-slate-300">{it.name}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{it.uom}</td>
                    <td className={`px-4 py-2 text-right font-mono font-semibold ${it.qty_on_hand > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                      {Number(it.qty_on_hand).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2 text-right font-mono dark:text-slate-300">
                      ₱{Number(it.avg_cost).toLocaleString('en-PH', { minimumFractionDigits: 4 })}
                    </td>
                    <td className="px-4 py-2 text-right font-mono dark:text-slate-300">
                      ₱{(it.qty_on_hand * it.avg_cost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <td colSpan={5} className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Total Stock Value</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                    ₱{items.reduce((s, it) => s + it.qty_on_hand * it.avg_cost, 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Item Consumption */}
      <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Item Consumption</h2>
          {isEditable && (
            <button type="button"
              onClick={() => setConsumption(c => [...c, { item_id: '', quantity: '', uom: uoms[0]?.code ?? '', unit_cost: '', remarks: '' }])}
              className="text-xs text-brand-600 hover:underline">+ Add line</button>
          )}
        </div>
        <div className="p-6">
          {!consumption.length ? (
            <p className="text-sm text-slate-400">No items consumed yet.</p>
          ) : (
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-700 text-slate-500">
                <tr>
                  <th className="pb-2 text-left font-medium w-56">Item</th>
                  <th className="pb-2 text-right font-medium w-24">Quantity</th>
                  <th className="pb-2 text-left font-medium w-20">UOM</th>
                  <th className="pb-2 text-right font-medium w-28">Unit Cost</th>
                  <th className="pb-2 text-right font-medium w-28">Total Cost</th>
                  <th className="pb-2 text-left font-medium">Remarks</th>
                  {isEditable && <th className="w-6" />}
                </tr>
              </thead>
              <tbody>
                {consumption.map((c, i) => {
                  const total = (parseFloat(c.quantity) || 0) * (parseFloat(c.unit_cost) || 0);
                  return (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                      <td className="py-2 pr-3">
                        <select value={c.item_id}
                          onChange={e => {
                            const item = items.find(it => it.id === e.target.value);
                            setConsumption(prev => {
                              const n = [...prev];
                              n[i] = {
                                ...n[i],
                                item_id: e.target.value,
                                uom: item?.uom ?? n[i].uom,
                                unit_cost: item?.avg_cost ? String(item.avg_cost) : n[i].unit_cost,
                              };
                              return n;
                            });
                          }}
                          disabled={!isEditable}
                          className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 disabled:bg-transparent disabled:border-0">
                          <option value="">Select item…</option>
                          {items.map(it => (
                            <option key={it.id} value={it.id}>
                              {it.sku} — {it.name} (on hand: {Number(it.qty_on_hand).toLocaleString()})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <input type="number" min={0} step="any" value={c.quantity}
                          onChange={e => setConsumption(prev => { const n = [...prev]; n[i] = { ...n[i], quantity: e.target.value }; return n; })}
                          disabled={!isEditable}
                          className="w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-right focus:outline-none disabled:text-slate-400" />
                      </td>
                      <td className="py-2 pr-3">
                        {isEditable ? (
                          <select value={c.uom}
                            onChange={e => setConsumption(prev => { const n = [...prev]; n[i] = { ...n[i], uom: e.target.value }; return n; })}
                            className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                            <option value="">— UOM —</option>
                            {uoms.map(u => <option key={u.id} value={u.code}>{u.code}</option>)}
                            {/* keep current value selectable even if not in list */}
                            {c.uom && !uoms.find(u => u.code === c.uom) && (
                              <option value={c.uom}>{c.uom}</option>
                            )}
                          </select>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">{c.uom}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <input type="number" min={0} step="any" value={c.unit_cost}
                          onChange={e => setConsumption(prev => { const n = [...prev]; n[i] = { ...n[i], unit_cost: e.target.value }; return n; })}
                          disabled={!isEditable}
                          className="w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-right focus:outline-none disabled:text-slate-400" />
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">₱{total.toFixed(2)}</td>
                      <td className="py-2 pr-3">
                        <input type="text" value={c.remarks}
                          onChange={e => setConsumption(prev => { const n = [...prev]; n[i] = { ...n[i], remarks: e.target.value }; return n; })}
                          disabled={!isEditable}
                          className="w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 focus:outline-none disabled:text-slate-400" />
                      </td>
                      {isEditable && (
                        <td className="py-2 text-center">
                          <button type="button"
                            onClick={() => setConsumption(c => c.filter((_, j) => j !== i))}
                            className="text-red-400 hover:text-red-600">×</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 dark:border-slate-700">
                  <td colSpan={4} className="pt-2 text-right text-xs font-medium text-slate-500">Total</td>
                  <td className="pt-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                    ₱{consumption.reduce((s, c) => s + (parseFloat(c.quantity) || 0) * (parseFloat(c.unit_cost) || 0), 0).toFixed(2)}
                  </td>
                  <td colSpan={isEditable ? 2 : 1} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* Save button at bottom */}
      {isEditable && (
        <div className="mt-6 flex gap-3">
          <button onClick={save} disabled={saving}
            className="rounded bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}
