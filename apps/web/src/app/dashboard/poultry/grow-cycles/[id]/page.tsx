'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Cycle {
  id: string; doc_no: string; status: string; year: number;
  start_date: string; expected_end_date: string | null; actual_end_date: string | null;
  heads_in: number; heads_available: number; total_mortality: number; heads_harvested: number;
  est_harvest_recovery: number | null; grow_reference: string | null;
  approx_heads: number; chick_price_per_head: number; approx_chick_price_per_head: number;
  culling_qty: number; remarks: string | null;
  item_name: string; sku: string; batch_no: string;
  building_name: string | null; branch_name: string | null;
  daily_mortality: Array<{ day_no: number; qty: number }>;
  weekly_weights: Array<{ week_no: number; weight_kg: number }>;
  item_consumption: Array<{ id: string; line_no: number; item_id: string; item_name: string; sku: string; quantity: number; uom: string; unit_cost: number; total_cost: number; remarks: string | null }>;
}

interface Item { id: string; sku: string; name: string; }

const DAYS = Array.from({ length: 35 }, (_, i) => i + 1);
const WEEKS = [0, 7, 14, 21, 25, 32];
const STATUS_COLORS: Record<string, string> = { active: 'bg-emerald-100 text-emerald-700', harvesting: 'bg-amber-100 text-amber-700', completed: 'bg-blue-100 text-blue-700', closed: 'bg-slate-100 text-slate-600' };

export default function GrowCycleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<Cycle | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<'error' | 'success'>('error');

  // Edit state
  const [dailyMortality, setDailyMortality] = useState<Record<number, string>>({});
  const [culling, setCulling] = useState('');
  const [weeklyWeights, setWeeklyWeights] = useState<Record<number, string>>({});
  const [consumption, setConsumption] = useState<Array<{ item_id: string; quantity: string; uom: string; unit_cost: string; remarks: string }>>([]);

  const load = useCallback(() => {
    const cid = localStorage.getItem('company_id') ?? '';
    api.get<Cycle>(`/poultry/grow-cycles/${id}`).then(d => {
      setDoc(d);
      // Populate edit states
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
    // Load items for consumption
    if (cid) api.get<Item[]>(`/inventory/items?company_id=${cid}&limit=500`).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
  }, [id]);

  useEffect(() => { load(); }, [load]);

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
        culling_qty: parseFloat(culling) || 0,
        daily_mortality: dm,
        weekly_weights: ww,
        item_consumption: cons,
      });
      setMsg('Saved successfully'); setMsgType('success');
      load();
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
              <Link href={`/dashboard/poultry/tally-sheets/new?grow_cycle_id=${doc.id}`}
                className="rounded border border-brand-300 px-4 py-1.5 text-sm text-brand-600 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-400">
                Create Tally Sheet
              </Link>
              <button onClick={complete} disabled={saving}
                className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Mark Completed
              </button>
            </>
          )}
          <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-lg leading-none">←</button>
        </div>
      </div>

      {msg && (
        <div className={`mb-4 rounded border px-3 py-2 text-sm ${msgType === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg}</div>
      )}

      {/* Header card */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
        <div className="grid grid-cols-4 gap-x-8 gap-y-5 text-sm">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Transaction Number</div>
            <div className="text-slate-900 dark:text-slate-100 font-mono">{doc.doc_no}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Start Date</div>
            <div className="text-slate-900 dark:text-slate-100">{formatDate(doc.start_date)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Est. Harvest Recovery</div>
            <div className={`text-slate-900 dark:text-slate-100 ${!doc.est_harvest_recovery ? 'text-red-500' : ''}`}>
              {doc.est_harvest_recovery != null ? Number(doc.est_harvest_recovery).toFixed(2) : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Remarks</div>
            <div className="text-slate-900 dark:text-slate-100">{doc.remarks ?? '—'}</div>
          </div>

          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Year</div>
            <div className="text-slate-900 dark:text-slate-100">{doc.year}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Grow Reference</div>
            <div className="text-slate-900 dark:text-slate-100">{doc.grow_reference ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">End Date</div>
            <div className="text-slate-900 dark:text-slate-100">{doc.expected_end_date ? formatDate(doc.expected_end_date) : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Approx Heads</div>
            <div className="text-slate-900 dark:text-slate-100">{Number(doc.approx_heads).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Status</div>
            <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[doc.status] ?? 'bg-slate-100 text-slate-600'}`}>{doc.status}</span>
          </div>

          <div className="col-span-2">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Location</div>
            <div className="text-slate-900 dark:text-slate-100">{doc.branch_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Chick Price/Head</div>
            <div className="text-slate-900 dark:text-slate-100">{Number(doc.chick_price_per_head).toFixed(6)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Approx Chick Price/Head</div>
            <div className="text-slate-900 dark:text-slate-100">{Number(doc.approx_chick_price_per_head).toFixed(6)}</div>
          </div>

          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Building</div>
            <div className="text-slate-900 dark:text-slate-100">{doc.building_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Chick Batch</div>
            <div className="text-slate-900 dark:text-slate-100">{doc.item_name} {doc.batch_no}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Heads</div>
            <div className="text-slate-900 dark:text-slate-100 font-semibold">{Number(doc.heads_in).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Available / Harvested</div>
            <div className="text-emerald-600 font-semibold">{Number(doc.heads_available).toLocaleString()} / {Number(doc.heads_harvested).toLocaleString()}</div>
          </div>
        </div>
      </div>

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
              {doc.heads_in > 0 ? ((totalMortalityWithCulling / doc.heads_in) * 100).toFixed(2) : '0.00'}%
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

      {/* Item Consumption */}
      <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Item Consumption</h2>
          {isEditable && (
            <button type="button"
              onClick={() => setConsumption(c => [...c, { item_id: '', quantity: '', uom: 'bags', unit_cost: '', remarks: '' }])}
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
                          onChange={e => setConsumption(prev => { const n = [...prev]; n[i] = { ...n[i], item_id: e.target.value }; return n; })}
                          disabled={!isEditable}
                          className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 disabled:bg-transparent disabled:border-0">
                          <option value="">Select item…</option>
                          {items.map(it => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <input type="number" min={0} step="any" value={c.quantity}
                          onChange={e => setConsumption(prev => { const n = [...prev]; n[i] = { ...n[i], quantity: e.target.value }; return n; })}
                          disabled={!isEditable}
                          className="w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-right focus:outline-none disabled:text-slate-400" />
                      </td>
                      <td className="py-2 pr-3">
                        <input type="text" value={c.uom}
                          onChange={e => setConsumption(prev => { const n = [...prev]; n[i] = { ...n[i], uom: e.target.value }; return n; })}
                          disabled={!isEditable}
                          className="w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1 focus:outline-none disabled:text-slate-400" />
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
