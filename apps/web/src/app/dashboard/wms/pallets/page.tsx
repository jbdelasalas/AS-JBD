'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import QrScanner from '@/components/QrScanner';

// Build and manage pallets. A pallet groups boxes so the whole stack moves on a
// single scan over in Scan & Move; loading a box here does not move stock.

interface Pallet {
  id: string; pallet_no: string; status: string; qr_code: string | null;
  bin_code: string | null; warehouse_name: string | null;
  box_count: number; net_weight_kg: string; created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-100 text-slate-700 dark:text-slate-300',
  shipped: 'bg-blue-100 text-blue-700',
};

export default function PalletsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [rows, setRows] = useState<Pallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState<Pallet | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCompanyId(localStorage.getItem('company_id')); }, []);

  const load = useCallback((cid: string) => {
    setLoading(true);
    api.get<{ data: Pallet[] }>(`/wms/pallets?company_id=${cid}`)
      .then((r) => {
        setRows(r.data);
        // Keep the open loading panel in sync with the refreshed counts.
        setActive((cur) => (cur ? r.data.find((p) => p.id === cur.id) ?? null : null));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (companyId) load(companyId); }, [companyId, load]);

  const createPallet = async () => {
    if (!companyId) return;
    setError(null);
    try {
      const p = await api.post<{ pallet_no: string }>('/wms/pallets', { company_id: companyId });
      setNotice(`Created ${p.pallet_no} — print its label, then load boxes.`);
      load(companyId);
    } catch (e) { setError((e as Error).message); }
  };

  const loadBox = useCallback(async (raw: string) => {
    if (!companyId || !active) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/wms/pallets/${active.id}/boxes`, { company_id: companyId, code: raw });
      setNotice(`Loaded onto ${active.pallet_no}.`);
      load(companyId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [companyId, active, load]);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Pallets</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Group boxes onto a pallet, then relocate the whole stack from{' '}
            <Link href="/dashboard/wms/scan" className="text-brand-700 hover:underline dark:text-brand-400">Scan &amp; Move</Link>.
          </p>
        </div>
        <button
          onClick={createPallet}
          className="shrink-0 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + New pallet
        </button>
      </div>

      {notice && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {active && (
        <div className="mb-4 rounded-lg border-2 border-brand-500 bg-brand-50/60 p-4 dark:bg-brand-950/30">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Loading {active.pallet_no}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {active.box_count} box{active.box_count === 1 ? '' : 'es'} · {Number(active.net_weight_kg).toLocaleString()} kg
              </p>
            </div>
            <button
              onClick={() => setActive(null)}
              className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300"
            >
              Done
            </button>
          </div>
          <QrScanner onScan={loadBox} busy={busy} autoFocus placeholder="Scan a box to load…" />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : !rows.length ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No pallets yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Pallet</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2 text-right">Boxes</th>
                <th className="px-3 py-2 text-right">Weight</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {rows.map((p) => (
                <tr key={p.id} className="bg-white dark:bg-slate-900">
                  <td className="px-3 py-2 font-mono text-xs text-slate-800 dark:text-slate-200">{p.pallet_no}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                    {p.bin_code ?? '—'}{p.warehouse_name ? ` · ${p.warehouse_name}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">{p.box_count}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300">
                    {Number(p.net_weight_kg).toLocaleString()} kg
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[p.status] ?? STATUS_STYLES.open}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.status === 'open' && (
                      <button
                        onClick={() => { setActive(p); setNotice(null); }}
                        className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Load boxes
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
