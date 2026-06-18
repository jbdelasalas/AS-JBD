'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Item { id: string; sku: string; name: string; uom: string; tracking_mode: string; }
interface Lot { id: string; lot_no: string; expiry_date: string | null; sku: string; item_name: string; uom: string; qty_on_hand: number; }
interface Serial { id: string; serial_no: string; status: string; sku: string; item_name: string; warehouse_name: string | null; bin_code: string | null; lot_no: string | null; }

const TABS = ['items', 'lots', 'serials'] as const;
type Tab = typeof TABS[number];

export default function LotsSerialsPage() {
  const [tab, setTab] = useState<Tab>('items');
  const [items, setItems] = useState<Item[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [serials, setSerials] = useState<Serial[]>([]);
  const [error, setError] = useState<string | null>(null);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const loadItems = useCallback(() => { if (companyId) api.get<Item[]>(`/wms/items?company_id=${companyId}`).then(setItems).catch((e) => setError(e.message)); }, [companyId]);
  const loadLots = useCallback(() => { if (companyId) api.get<Lot[]>(`/wms/lots?company_id=${companyId}`).then(setLots).catch((e) => setError(e.message)); }, [companyId]);
  const loadSerials = useCallback(() => { if (companyId) api.get<Serial[]>(`/wms/serials?company_id=${companyId}`).then(setSerials).catch((e) => setError(e.message)); }, [companyId]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { if (tab === 'lots') loadLots(); if (tab === 'serials') loadSerials(); }, [tab, loadLots, loadSerials]);

  async function setMode(item: Item, mode: string) {
    setError(null);
    try { await api.patch('/wms/items', { item_id: item.id, tracking_mode: mode }); loadItems(); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Lots &amp; Serials</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Configure per-item tracking and review lot/serial inventory.</p>
      </div>

      <div className="mb-3 flex gap-1.5">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded px-3 py-1 text-xs font-medium capitalize ${tab === t ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            {t === 'items' ? 'Item tracking' : t}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {tab === 'items' && (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr><th className="px-3 py-2 text-left">SKU</th><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">Tracking</th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{it.sku}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{it.name}</td>
                  <td className="px-3 py-2">
                    <select value={it.tracking_mode} onChange={(e) => setMode(it, e.target.value)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="none">None</option><option value="lot">Lot / batch</option><option value="serial">Serial</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'lots' && (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">Lot</th><th className="px-3 py-2 text-left">Expiry</th><th className="px-3 py-2 text-right">On hand</th></tr>
            </thead>
            <tbody>
              {lots.length === 0 ? <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-400">No lots yet.</td></tr> : lots.map((l) => (
                <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300"><span className="font-mono">{l.sku}</span> – {l.item_name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{l.lot_no}</td>
                  <td className={`px-3 py-2 text-xs ${l.expiry_date && new Date(l.expiry_date) < new Date() ? 'text-red-600' : 'text-slate-600 dark:text-slate-400'}`}>{l.expiry_date ? formatDate(l.expiry_date) : '—'}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-900 dark:text-slate-100">{l.qty_on_hand.toLocaleString()} {l.uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'serials' && <SerialsTab items={items} serials={serials} reload={loadSerials} />}
    </div>
  );
}

function SerialsTab({ items, serials, reload }: { items: Item[]; serials: Serial[]; reload: () => void }) {
  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;
  const [itemId, setItemId] = useState('');
  const [raw, setRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const STATUS_STYLES: Record<string, string> = {
    in_stock: 'bg-emerald-100 text-emerald-700', reserved: 'bg-amber-100 text-amber-700',
    shipped: 'bg-slate-200 text-slate-600', consumed: 'bg-slate-200 text-slate-600',
  };

  async function register(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!companyId || !itemId) { setMsg('Pick an item'); return; }
    const serial_nos = raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!serial_nos.length) { setMsg('Enter at least one serial number'); return; }
    setSaving(true);
    try {
      const res = await api.post<{ inserted: number; skipped: number }>('/wms/serials', { company_id: companyId, item_id: itemId, serial_nos });
      setMsg(`Registered ${res.inserted}${res.skipped ? `, skipped ${res.skipped} duplicate(s)` : ''}.`);
      setRaw(''); reload();
    } catch (e) { setMsg((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={register} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Register serial units</h2>
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-4">
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              <option value="">Select item…</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.sku} – {it.name}</option>)}
            </select>
          </div>
          <div className="col-span-6">
            <input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Serial numbers, comma or newline separated"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div className="col-span-2">
            <button type="submit" disabled={saving} className="w-full rounded bg-brand-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving ? '…' : 'Register'}</button>
          </div>
        </div>
        {msg && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{msg}</p>}
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr><th className="px-3 py-2 text-left">Serial</th><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">Location</th><th className="px-3 py-2 text-left">Lot</th><th className="px-3 py-2 text-left">Status</th></tr>
          </thead>
          <tbody>
            {serials.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">No serials yet.</td></tr> : serials.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{s.serial_no}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300"><span className="font-mono">{s.sku}</span> – {s.item_name}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{s.warehouse_name ?? '—'}{s.bin_code ? ` / ${s.bin_code}` : ''}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{s.lot_no ?? '—'}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[s.status] ?? ''}`}>{s.status.replace('_', ' ')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
