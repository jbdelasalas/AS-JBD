'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Cycle {
  id: string; doc_no: string; status: string; year: number; start_date: string;
  expected_end_date: string | null; actual_end_date: string | null;
  heads_in: number; heads_available: number; total_mortality: number; heads_harvested: number; est_harvest_recovery: number | null;
  item_name: string; sku: string; batch_no: string; building_name: string | null; building_code: string | null; remarks: string | null;
  mortality_logs: Array<{ id: string; log_date: string; heads: number; cause: string | null }>;
}
const S: Record<string, string> = { active: 'bg-emerald-100 text-emerald-700', harvesting: 'bg-amber-100 text-amber-700', completed: 'bg-blue-100 text-blue-700', closed: 'bg-slate-100 text-slate-600' };

export default function GrowCycleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<Cycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [logForm, setLogForm] = useState({ log_date: new Date().toISOString().split('T')[0], heads: '', cause: '' });
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(() => {
    api.get<Cycle>(`/poultry/grow-cycles/${id}`).then(setDoc).catch(() => {}).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function logMortality(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await api.post(`/poultry/grow-cycles/${id}/mortality`, { ...logForm, heads: parseFloat(logForm.heads) }); setLogForm(f => ({ ...f, heads: '', cause: '' })); setShowLog(false); load(); }
    catch (e: unknown) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function complete() {
    setBusy(true); setMsg(null);
    try { await api.post(`/poultry/grow-cycles/${id}/complete`, {}); load(); }
    catch (e: unknown) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  if (!doc) return <div className="py-12 text-center text-sm text-red-500">Not found.</div>;

  const mortalityPct = doc.heads_in > 0 ? ((doc.total_mortality / doc.heads_in) * 100).toFixed(2) : '0.00';

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold font-mono text-slate-900 dark:text-slate-100">{doc.doc_no}</h1>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${S[doc.status] ?? ''}`}>{doc.status}</span>
          </div>
          <p className="text-sm text-slate-500">{doc.sku} — {doc.item_name} · Batch: {doc.batch_no}</p>
        </div>
        <div className="flex gap-2">
          {(doc.status === 'active' || doc.status === 'harvesting') && (
            <>
              <button onClick={() => setShowLog(v => !v)} className="rounded border border-amber-300 px-4 py-1.5 text-sm text-amber-700 hover:bg-amber-50">Log Mortality</button>
              <Link href={`/dashboard/poultry/tally-sheets/new?grow_cycle_id=${doc.id}`} className="rounded bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700">Create Tally Sheet</Link>
              <button onClick={complete} disabled={busy} className="rounded bg-slate-600 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50">Mark Completed</button>
            </>
          )}
        </div>
      </div>
      {msg && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}

      {showLog && (
        <form onSubmit={logMortality} className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-slate-800 p-4">
          <div className="mb-3 text-sm font-medium text-amber-800 dark:text-amber-300">Log Mortality</div>
          <div className="flex gap-3">
            <div><label className="mb-1 block text-xs text-amber-700 dark:text-amber-400">Date</label><input type="date" value={logForm.log_date} onChange={e => setLogForm(f => ({ ...f, log_date: e.target.value }))} className="rounded border border-amber-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" /></div>
            <div><label className="mb-1 block text-xs text-amber-700 dark:text-amber-400">Heads *</label><input required type="number" min={1} value={logForm.heads} onChange={e => setLogForm(f => ({ ...f, heads: e.target.value }))} className="rounded border border-amber-300 px-2 py-1 text-sm w-24 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" /></div>
            <div className="flex-1"><label className="mb-1 block text-xs text-amber-700 dark:text-amber-400">Cause</label><input type="text" value={logForm.cause} onChange={e => setLogForm(f => ({ ...f, cause: e.target.value }))} className="w-full rounded border border-amber-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" /></div>
            <div className="flex items-end gap-2">
              <button type="submit" disabled={busy} className="rounded bg-amber-600 px-4 py-1.5 text-sm text-white hover:bg-amber-700 disabled:opacity-50">Log</button>
              <button type="button" onClick={() => setShowLog(false)} className="rounded border px-4 py-1.5 text-sm text-slate-600">Cancel</button>
            </div>
          </div>
        </form>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Heads In', value: Number(doc.heads_in).toLocaleString(), color: 'text-slate-900 dark:text-slate-100' },
          { label: 'Available', value: Number(doc.heads_available).toLocaleString(), color: 'text-emerald-600' },
          { label: 'Mortality', value: `${Number(doc.total_mortality).toLocaleString()} (${mortalityPct}%)`, color: 'text-red-600' },
          { label: 'Harvested', value: Number(doc.heads_harvested).toLocaleString(), color: 'text-blue-600' },
        ].map(k => (
          <div key={k.label} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">{k.label}</div>
            <div className={`mt-1 text-xl font-semibold ${k.color}`}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          {[['Building', doc.building_name ? `${doc.building_code} — ${doc.building_name}` : '—'], ['Start Date', formatDate(doc.start_date)], ['Expected Harvest', doc.expected_end_date ? formatDate(doc.expected_end_date) : '—'], ['Actual End', doc.actual_end_date ? formatDate(doc.actual_end_date) : '—'], ['Est. Recovery', doc.est_harvest_recovery ? `${doc.est_harvest_recovery}%` : '—'], ['Year', String(doc.year)]].map(([l, v]) => (
            <div key={l}><div className="text-xs text-slate-500">{l}</div><div className="mt-0.5 text-slate-900 dark:text-slate-100">{v}</div></div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Mortality Log</div>
        {!doc.mortality_logs.length ? <p className="text-xs text-slate-400">No mortality recorded.</p> : (
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500">
                <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-right">Heads</th><th className="px-3 py-2 text-left">Cause</th></tr>
              </thead>
              <tbody>
                {doc.mortality_logs.map(m => (
                  <tr key={m.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-3 py-2 text-slate-500">{formatDate(m.log_date)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-500">{Number(m.heads).toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{m.cause ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
    </div>
  );
}
