'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface BalRow { id: string; sku: string; item_name: string; uom: string; warehouse_name: string | null; warehouse_code: string | null; qty_heads: number; qty_kgs: number; avg_cost: number; last_updated: string; }
interface LedgerRow { id: string; transaction_date: string; movement_type: string; source_type: string; source_doc_no: string | null; sku: string; item_name: string; warehouse_name: string | null; heads_in: number; heads_out: number; kgs_in: number; kgs_out: number; balance_heads: number; balance_kgs: number; }

export default function PoultryInventoryPage() {
  const [balances, setBalances] = useState<BalRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [tab, setTab] = useState<'balance' | 'ledger'>('balance');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true);
    if (tab === 'balance') {
      api.get<BalRow[]>(`/poultry/inventory/balance?company_id=${cid}`)
        .then(setBalances).catch(() => {}).finally(() => setLoading(false));
    } else {
      api.get<LedgerRow[]>(`/poultry/inventory/ledger?company_id=${cid}&limit=200`)
        .then(setLedger).catch(() => {}).finally(() => setLoading(false));
    }
  }, [tab]);

  const mvtColor = (t: string) => ({ in: 'text-emerald-600', out: 'text-red-500', convert_in: 'text-blue-600', convert_out: 'text-amber-600' }[t] ?? 'text-slate-600');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Poultry Inventory</h1>
          <p className="text-sm text-slate-500">Live balance and movement ledger.</p>
        </div>
      </div>

      <div className="mb-4 flex gap-2 border-b border-slate-200 dark:border-slate-700">
        {(['balance', 'ledger'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-2 px-3 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t === 'balance' ? 'Stock Balance' : 'Movement Ledger'}
          </button>
        ))}
      </div>

      {tab === 'balance' && (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Warehouse</th>
                <th className="px-3 py-2 text-right">Qty (Heads)</th>
                <th className="px-3 py-2 text-right">Qty (KGS)</th>
                <th className="px-3 py-2 text-right">Avg Cost</th>
                <th className="px-3 py-2 text-right">Total Value</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="py-8 text-center text-slate-400 text-xs">Loading…</td></tr>
                : !balances.length ? <tr><td colSpan={7} className="py-8 text-center text-slate-400 text-xs">No inventory on hand.</td></tr>
                : balances.map(r => (
                  <tr key={r.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{r.sku}</td>
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{r.item_name}</td>
                    <td className="px-3 py-2 text-slate-500">{r.warehouse_code ? `${r.warehouse_code} — ${r.warehouse_name}` : '—'}</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${r.qty_heads > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{r.qty_heads.toLocaleString()}</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${r.qty_kgs > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{r.qty_kgs.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">₱{r.avg_cost.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">₱{(r.qty_kgs * r.avg_cost).toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
            {balances.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <td colSpan={6} className="px-3 py-2 text-right text-xs font-medium text-slate-600 dark:text-slate-400">Total Inventory Value</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                    ₱{balances.reduce((s, r) => s + r.qty_kgs * r.avg_cost, 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {tab === 'ledger' && (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Document</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Warehouse</th>
                <th className="px-3 py-2 text-right">Heads In</th>
                <th className="px-3 py-2 text-right">Heads Out</th>
                <th className="px-3 py-2 text-right">KGS In</th>
                <th className="px-3 py-2 text-right">KGS Out</th>
                <th className="px-3 py-2 text-right">Bal Heads</th>
                <th className="px-3 py-2 text-right">Bal KGS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={11} className="py-8 text-center text-slate-400">Loading…</td></tr>
                : !ledger.length ? <tr><td colSpan={11} className="py-8 text-center text-slate-400">No movements recorded.</td></tr>
                : ledger.map(r => (
                  <tr key={r.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                    <td className="px-3 py-1.5 text-slate-500">{r.transaction_date.split('T')[0]}</td>
                    <td className="px-3 py-1.5 font-mono text-brand-600">{r.source_doc_no ?? '—'}</td>
                    <td className={`px-3 py-1.5 font-medium capitalize ${mvtColor(r.movement_type)}`}>{r.movement_type.replace('_', ' ')}</td>
                    <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300">{r.sku} {r.item_name}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.warehouse_name ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-emerald-600">{Number(r.heads_in) > 0 ? Number(r.heads_in).toLocaleString() : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-red-500">{Number(r.heads_out) > 0 ? Number(r.heads_out).toLocaleString() : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-emerald-600">{Number(r.kgs_in) > 0 ? Number(r.kgs_in).toFixed(2) : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-red-500">{Number(r.kgs_out) > 0 ? Number(r.kgs_out).toFixed(2) : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-700 dark:text-slate-300">{Number(r.balance_heads).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-700 dark:text-slate-300">{Number(r.balance_kgs).toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex gap-4 text-xs text-slate-500">
        <Link href="/dashboard/poultry/order-ins" className="hover:text-brand-600">Order In</Link>
        <Link href="/dashboard/poultry/inventory-ins" className="hover:text-brand-600">Inventory In</Link>
        <Link href="/dashboard/poultry/tally-sheets" className="hover:text-brand-600">Tally Sheets</Link>
        <Link href="/dashboard/poultry/conversions" className="hover:text-brand-600">Conversions</Link>
        <Link href="/dashboard/poultry/deliveries" className="hover:text-brand-600">Deliveries</Link>
      </div>
    </div>
  );
}
