'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Batch {
  id: string; batch_no: string; heads_available: number; heads_in: number;
  item_name: string; date_received: string; price_per_head: number;
  grn_no: string | null; grn_date: string | null;
  po_id: string | null; po_no: string | null;
}
interface Building { id: string; code: string; name: string; branch_id: string | null; }
interface Branch { id: string; name: string; code: string; }
interface GrowRef { id: string; code: string; name: string; }
interface CostCenter { id: string; code: string; name: string; }

export default function NewGrowCyclePage() {
  const router = useRouter();
  const [allBatches, setAllBatches] = useState<Batch[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [growRefs, setGrowRefs] = useState<GrowRef[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = new Date().toISOString().split('T')[0];
  const endDefault = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const [form, setForm] = useState({
    batch_id: '', branch_id: '', building_id: '',
    grow_reference: '', cost_center_id: '', year: new Date().getFullYear().toString(),
    start_date: now, expected_end_date: endDefault,
    heads: '', approx_heads: '', est_harvest_recovery: '70',
    chick_price_per_head: '', approx_chick_price_per_head: '',
    remarks: '',
  });

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<Batch[]>(`/poultry/chick-batches?company_id=${cid}&status=available`).then(setAllBatches).catch(() => {});
    api.get<Building[]>(`/poultry/buildings?company_id=${cid}`).then(setBuildings).catch(() => {});
    api.get<Branch[]>(`/admin/branches?company_id=${cid}`).then(r => setBranches(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<GrowRef[]>(`/poultry/grow-references?company_id=${cid}`).then(r => setGrowRefs(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<{ data: CostCenter[] }>(`/admin/cost-centers?company_id=${cid}&limit=100`).then(r => setCostCenters(r.data ?? [])).catch(() => {});
  }, []);

  // Filter buildings by selected location
  const filteredBuildings = form.branch_id
    ? buildings.filter(b => b.branch_id === form.branch_id)
    : buildings;

  const selectedBatch = allBatches.find(b => b.id === form.batch_id);

  function setField(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleLocationChange(branchId: string) {
    setForm(f => ({ ...f, branch_id: branchId, building_id: '', batch_id: '', heads: '', chick_price_per_head: '' }));
  }

  function handleBatchChange(batchId: string) {
    const batch = allBatches.find(b => b.id === batchId);
    setForm(f => ({
      ...f,
      batch_id: batchId,
      heads: batch ? String(batch.heads_available) : '',
      chick_price_per_head: batch?.price_per_head ? String(batch.price_per_head) : '',
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.batch_id) { setError('Select a chick batch'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const rec = await api.post<{ id: string }>('/poultry/grow-cycles', {
        company_id: cid,
        batch_id: form.batch_id,
        branch_id: form.branch_id || undefined,
        building_id: form.building_id || undefined,
        grow_reference: form.grow_reference || undefined,
        cost_center_id: form.cost_center_id || undefined,
        start_date: form.start_date,
        expected_end_date: form.expected_end_date || undefined,
        heads: form.heads ? parseFloat(form.heads) : undefined,
        approx_heads: form.approx_heads ? parseFloat(form.approx_heads) : undefined,
        est_harvest_recovery: form.est_harvest_recovery ? parseFloat(form.est_harvest_recovery) : undefined,
        chick_price_per_head: form.chick_price_per_head ? parseFloat(form.chick_price_per_head) : undefined,
        approx_chick_price_per_head: form.approx_chick_price_per_head ? parseFloat(form.approx_chick_price_per_head) : undefined,
        remarks: form.remarks || undefined,
      });
      router.push(`/dashboard/poultry/grow-cycles/${rec.id}`);
    } catch (e: unknown) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">New Grow Cycle</h1>
          <p className="text-sm text-slate-500">Create a growing cycle for a chick batch.</p>
        </div>
        <button type="button" onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
      </div>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-0">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
          <div className="grid grid-cols-4 gap-x-8 gap-y-5">

            {/* Row 1 */}
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Transaction Number</label>
              <input readOnly value="(auto)" className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Start Date *</label>
              <input required type="date" value={form.start_date} onChange={e => setField('start_date', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Est. Harvest Recovery %</label>
              <input type="number" min={0} max={100} step="0.01" value={form.est_harvest_recovery}
                onChange={e => setField('est_harvest_recovery', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Remarks</label>
              <input type="text" value={form.remarks} onChange={e => setField('remarks', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>

            {/* Row 2 */}
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Year</label>
              <input type="number" value={form.year} onChange={e => setField('year', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">End Date</label>
              <input type="date" value={form.expected_end_date} onChange={e => setField('expected_end_date', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Approx Heads</label>
              <input type="number" min={0} value={form.approx_heads} onChange={e => setField('approx_heads', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Status</label>
              <input readOnly value="Active" className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800" />
            </div>

            {/* Row 3 — Location + Grow Reference + Cost Center */}
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Location *</label>
              <select required value={form.branch_id} onChange={e => handleLocationChange(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select location…</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Grow Reference</label>
              <select value={form.grow_reference} onChange={e => setField('grow_reference', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">— none —</option>
                {growRefs.map(g => <option key={g.id} value={g.name}>{g.code} — {g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Cost Center</label>
              <select value={form.cost_center_id} onChange={e => setField('cost_center_id', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">— none —</option>
                {costCenters.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>

            {/* Row 4 — Building + Chick Batch (with PO tag) */}
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Building</label>
              <select value={form.building_id} onChange={e => setField('building_id', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select building…</option>
                {filteredBuildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Chick Batch *</label>
              <select required value={form.batch_id} onChange={e => handleBatchChange(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select batch…</option>
                {allBatches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.item_name} — {b.batch_no}{b.po_no ? ` [${b.po_no}]` : ''}{b.grn_no ? ` · ${b.grn_no}` : ''} ({Number(b.heads_available).toLocaleString()} heads)
                  </option>
                ))}
              </select>
              {selectedBatch && (
                <p className="mt-0.5 text-xs text-slate-400">
                  Available: {Number(selectedBatch.heads_available).toLocaleString()} heads
                  {selectedBatch.po_no && ` · PO: ${selectedBatch.po_no}`}
                  {selectedBatch.grn_no && ` · GRN: ${selectedBatch.grn_no}`}
                </p>
              )}
            </div>

            {/* Row 5 — Heads and pricing (auto-filled from GRN) */}
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Heads</label>
              <input type="number" min={1} value={form.heads}
                onChange={e => setField('heads', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              {selectedBatch && <p className="mt-0.5 text-xs text-slate-400">Max: {Number(selectedBatch.heads_available).toLocaleString()}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Chick Price/Head</label>
              <input type="number" min={0} step="0.000001" value={form.chick_price_per_head}
                onChange={e => setField('chick_price_per_head', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              {selectedBatch && <p className="mt-0.5 text-xs text-slate-400">From GRN</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Approx Chick Price/Head</label>
              <input type="number" min={0} step="0.000001" value={form.approx_chick_price_per_head}
                onChange={e => setField('approx_chick_price_per_head', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-5">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Grow Cycle'}
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
