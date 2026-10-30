'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface JobOrder { id: string; batch_no: string; client_name: string; }
interface Item { id: string; name: string; sku?: string; }
interface OutputLine {
  id: string; batch_no: string; item_id: string; item_name: string; size_id: string | null;
  size_code: string | null; size_name: string | null;
  pack_count: number; head_count: number; weight_kg: string;
  transferred_kg: string; transferred_at: string | null;
}
// Editable draft row in the grid
interface Draft { item_id: string; pack_count: string; head_count: string; weight_kg: string; }

export default function ProductionPage() {
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [jobOrderId, setJobOrderId] = useState('');
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const emptyDraft = (): Draft => ({ item_id: items[0]?.id ?? '', pack_count: '', head_count: '', weight_kg: '' });

  const loadLines = useCallback((batch: string) => {
    if (!companyId || !batch) { setLines([]); return; }
    setLoading(true);
    api.get<{ data: OutputLine[] }>(`/dressing-plant/production?company_id=${companyId}&job_order_id=${batch}`)
      .then((r) => setLines(r.data)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: JobOrder[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => { setOrders(r.data); if (r.data[0]) { setJobOrderId(r.data[0].id); loadLines(r.data[0].id); } }).catch(() => {});
    api.get<Item[]>(`/wms/items?company_id=${companyId}`).then(setItems).catch(() => {});
  }, [companyId, loadLines]);

  function pickBatch(id: string) { setJobOrderId(id); setDrafts([]); setNotice(null); loadLines(id); }

  function addDraft() { setDrafts((d) => [...d, emptyDraft()]); }
  function setDraft(i: number, patch: Partial<Draft>) { setDrafts((d) => d.map((row, idx) => idx === i ? { ...row, ...patch } : row)); }
  function removeDraft(i: number) { setDrafts((d) => d.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!companyId || !jobOrderId) return;
    setError(null); setNotice(null); setSaving(true);
    // Combine existing untransferred lines + drafts into the full set to save.
    const existing = lines.filter((l) => Number(l.transferred_kg) === 0).map((l) => ({
      item_id: l.item_id, size_id: l.size_id, pack_count: l.pack_count, head_count: l.head_count, weight_kg: Number(l.weight_kg),
    }));
    const newOnes = drafts.filter((d) => d.item_id && (Number(d.weight_kg) > 0 || Number(d.pack_count) > 0 || Number(d.head_count) > 0))
      .map((d) => ({ item_id: d.item_id, size_id: null, pack_count: Number(d.pack_count || 0), head_count: Number(d.head_count || 0), weight_kg: Number(d.weight_kg || 0) }));
    try {
      await api.post('/dressing-plant/production', { company_id: companyId, job_order_id: jobOrderId, lines: [...existing, ...newOnes] });
      setDrafts([]);
      loadLines(jobOrderId);
      setNotice('Production detail saved.');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  const untransferred = lines.filter((l) => Number(l.transferred_kg) === 0);
  const totals = lines.reduce(
    (a, l) => {
      a.packs += Number(l.pack_count || 0);
      a.heads += Number(l.head_count || 0);
      a.weight += Number(l.weight_kg || 0);
      return a;
    },
    { packs: 0, heads: 0, weight: 0 },
  );
  const inputCls = 'w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Processed Chicken — Production Detail</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Capture output per product for a batch, then put it away into warehouse bins
          (WMS → Put-aways, source: Production). The put-away moves it into the warehouse and starts cold-storage billing.
        </p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Batch</label>
          <select value={jobOrderId} onChange={(e) => pickBatch(e.target.value)} className={inputCls}>
            {orders.length === 0 && <option value="">No batches yet</option>}
            {orders.map((o) => <option key={o.id} value={o.id}>{o.batch_no} — {o.client_name}</option>)}
          </select>
        </div>
      </div>

      {/* Existing lines */}
      <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Batch</th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-right">Packs</th>
              <th className="px-3 py-2 text-right">Heads</th>
              <th className="px-3 py-2 text-right">Weight (kg)</th>
              <th className="px-3 py-2 text-left">WMS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : lines.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">No production lines yet. Add below.</td></tr>
            ) : lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200">{l.batch_no}</td>
                <td className="px-3 py-2 text-xs text-slate-800 dark:text-slate-200">{l.item_name}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{l.pack_count || '—'}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{l.head_count || '—'}</td>
                <td className="px-3 py-2 text-right text-xs font-medium text-slate-900 dark:text-slate-100">{Number(l.weight_kg).toLocaleString()}</td>
                <td className="px-3 py-2">
                  {Number(l.transferred_kg) > 0
                    ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">put away</span>
                    : <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600">pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300" colSpan={2}>TOTAL — batch</td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{totals.packs.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{totals.heads.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{totals.weight.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Draft editor */}
      <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Add production lines</span>
          <button onClick={addDraft} disabled={!jobOrderId} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 disabled:opacity-50">+ Row</button>
        </div>
        {drafts.length === 0 ? (
          <p className="text-xs text-slate-400">Click “+ Row” to add a product line.</p>
        ) : (
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <select value={d.item_id} onChange={(e) => setDraft(i, { item_id: e.target.value })} className={`col-span-6 ${inputCls}`}>
                  <option value="">Product…</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
                <input value={d.pack_count} onChange={(e) => setDraft(i, { pack_count: e.target.value })} type="number" min="0" placeholder="packs" className={`col-span-2 ${inputCls}`} />
                <input value={d.head_count} onChange={(e) => setDraft(i, { head_count: e.target.value })} type="number" min="0" placeholder="heads" className={`col-span-1 ${inputCls}`} />
                <input value={d.weight_kg} onChange={(e) => setDraft(i, { weight_kg: e.target.value })} type="number" min="0" step="0.01" placeholder="kg" className={`col-span-2 ${inputCls}`} />
                <button onClick={() => removeDraft(i)} className="col-span-1 text-xs text-red-500 hover:underline">✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3">
          <button onClick={save} disabled={saving || (drafts.length === 0 && untransferred.length === 0)}
            className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save production detail'}
          </button>
        </div>
      </div>

      {/* Put away into the warehouse */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50/40 p-3 dark:border-slate-700 dark:bg-slate-800/40">
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Saved lines go to the warehouse through a put-away, same as a purchase. Lines already put away are locked.
        </p>
        <Link href={`/dashboard/wms/putaways/new?job_order_id=${jobOrderId}`}
          className={`rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 ${!jobOrderId || untransferred.length === 0 ? 'pointer-events-none opacity-50' : ''}`}>
          Put away →
        </Link>
      </div>
    </div>
  );
}
