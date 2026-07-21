'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface JobOrder { id: string; batch_no: string; client_name: string; }
interface Recipe { id: string; code: string; name: string; bom: { item_id: string; item_name: string; qty_per_kg: string }[]; }
interface Run {
  id: string; batch_no: string; recipe_name: string; recipe_code: string;
  raw_meat_weight_kg: string; finished_weight_kg: string; consumption_posted: boolean;
}

export default function MarinationPage() {
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [rows, setRows] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [jobOrderId, setJobOrderId] = useState('');
  const [recipeId, setRecipeId] = useState('');
  const [rawMeat, setRawMeat] = useState('');
  const [finished, setFinished] = useState('');
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: Run[] }>(`/dressing-plant/marination?company_id=${companyId}`)
      .then((r) => setRows(r.data)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: JobOrder[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => { setOrders(r.data); if (r.data[0]) setJobOrderId(r.data[0].id); }).catch(() => {});
    api.get<{ data: Recipe[] }>(`/dressing-plant/recipes?company_id=${companyId}`)
      .then((r) => { setRecipes(r.data); if (r.data[0]) setRecipeId(r.data[0].id); }).catch(() => {});
    load();
  }, [companyId, load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!jobOrderId || !recipeId || !(Number(finished) > 0)) { setError('Batch, recipe and finished weight are required'); return; }
    setSaving(true);
    try {
      await api.post('/dressing-plant/marination', {
        company_id: companyId, job_order_id: jobOrderId, recipe_id: recipeId,
        raw_meat_weight_kg: rawMeat ? Number(rawMeat) : Number(finished),
        finished_weight_kg: Number(finished),
      });
      setRawMeat(''); setFinished('');
      load();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Marination</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Recording a run explodes the recipe BOM against finished weight, consumes ingredient inventory, and posts Dr 5220 / Cr 1145.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {recipes.length === 0 && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No recipes yet. Create one via the recipes API (POST /dressing-plant/recipes with a BOM) before recording marination runs.
        </div>
      )}

      <form onSubmit={submit} className="mb-5 grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="col-span-12 sm:col-span-4">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Batch *</label>
          <select value={jobOrderId} onChange={(e) => setJobOrderId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {orders.length === 0 && <option value="">No batches yet</option>}
            {orders.map((o) => <option key={o.id} value={o.id}>{o.batch_no} — {o.client_name}</option>)}
          </select>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Recipe *</label>
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {recipes.length === 0 && <option value="">No recipes</option>}
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
          </select>
        </div>
        <div className="col-span-6 sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Raw meat kg</label>
          <input value={rawMeat} onChange={(e) => setRawMeat(e.target.value)} type="number" min="0" step="0.01"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-6 sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Finished kg *</label>
          <input value={finished} onChange={(e) => setFinished(e.target.value)} type="number" min="0" step="0.01"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-12 flex items-end">
          <button type="submit" disabled={saving || !jobOrderId || !recipeId}
            className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? '…' : 'Record run & consume BOM'}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Batch</th>
              <th className="px-3 py-2 text-left">Recipe</th>
              <th className="px-3 py-2 text-right">Raw meat</th>
              <th className="px-3 py-2 text-right">Finished</th>
              <th className="px-3 py-2 text-left">Consumption</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">No marination runs yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{r.batch_no}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{r.recipe_code} — {r.recipe_name}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{Number(r.raw_meat_weight_kg).toLocaleString()} kg</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{Number(r.finished_weight_kg).toLocaleString()} kg</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${r.consumption_posted ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {r.consumption_posted ? 'posted' : 'no cost'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
