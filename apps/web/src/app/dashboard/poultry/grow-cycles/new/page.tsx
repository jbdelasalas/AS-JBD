'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Batch { id: string; batch_no: string; heads_available: number; item_name: string; date_received: string; }
interface Building { id: string; code: string; name: string; capacity_heads: number | null; }

export default function NewGrowCyclePage() {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ batch_id: '', start_date: new Date().toISOString().split('T')[0], expected_end_date: '', heads: '', building_id: '', est_harvest_recovery: '70', remarks: '' });

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    api.get<Batch[]>(`/poultry/chick-batches?company_id=${cid}&status=available`).then(setBatches).catch(() => {});
    api.get<Building[]>(`/poultry/buildings?company_id=${cid}`).then(setBuildings).catch(() => {});
  }, []);

  const selectedBatch = batches.find(b => b.id === form.batch_id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.batch_id) { setError('Select a chick batch'); return; }
    setSaving(true);
    try {
      const cid = localStorage.getItem('company_id')!;
      const rec = await api.post<{ id: string }>('/poultry/grow-cycles', {
        company_id: cid, batch_id: form.batch_id,
        start_date: form.start_date, expected_end_date: form.expected_end_date || undefined,
        heads: form.heads ? parseFloat(form.heads) : undefined,
        building_id: form.building_id || undefined,
        est_harvest_recovery: form.est_harvest_recovery ? parseFloat(form.est_harvest_recovery) : undefined,
        remarks: form.remarks || undefined,
      });
      router.push(`/dashboard/poultry/grow-cycles/${rec.id}`);
    } catch (e: unknown) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Grow Cycle</h1>
      <p className="mb-5 text-sm text-slate-500">Start growing a chick batch.</p>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Chick Batch *</label>
            <select required value={form.batch_id} onChange={e => setForm(f => ({ ...f, batch_id: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              <option value="">Select available batch…</option>
              {batches.map(b => <option key={b.id} value={b.id}>{b.batch_no} — {b.item_name} ({Number(b.heads_available).toLocaleString()} heads available)</option>)}
            </select>
            {selectedBatch && <p className="mt-1 text-xs text-slate-500">Available: {Number(selectedBatch.heads_available).toLocaleString()} heads · Received: {selectedBatch.date_received}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Heads to Grow</label>
              <input type="number" min={1} placeholder="All available" value={form.heads} onChange={e => setForm(f => ({ ...f, heads: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Building</label>
              <select value={form.building_id} onChange={e => setForm(f => ({ ...f, building_id: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select building…</option>
                {buildings.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}{b.capacity_heads ? ` (cap: ${b.capacity_heads.toLocaleString()})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Start Date *</label>
              <input required type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Expected Harvest Date</label>
              <input type="date" value={form.expected_end_date} onChange={e => setForm(f => ({ ...f, expected_end_date: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Est. Harvest Recovery %</label>
              <input type="number" min={0} max={100} step="0.01" value={form.est_harvest_recovery} onChange={e => setForm(f => ({ ...f, est_harvest_recovery: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Remarks</label>
              <input type="text" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Start Grow Cycle'}</button>
          <button type="button" onClick={() => router.back()} className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </div>
  );
}
