'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';

interface Transaction {
  txn_type: string; ref: string; txn_date: string | null;
  quantity: number; unit_price: number; line_total: number;
  party_name: string; doc_id: string; status: string;
}

interface Item {
  id: string; company_id: string; sku: string; name: string; uom: string;
  item_type: string; costing_method: string; standard_cost: number;
  selling_price: number; reorder_point: number; is_active: boolean;
  category_id: string | null; category_name: string | null;
  inventory_account_id: string | null;       inventory_account_name: string | null;
  cogs_account_id: string | null;            cogs_account_name: string | null;
  revenue_account_id: string | null;         revenue_account_name: string | null;
  purchase_variance_account_id: string | null; purchase_variance_account_name: string | null;
}

interface Category { id: string; name: string; }
interface UomRow   { id: string; code: string; name: string; }
interface Account  { id: string; code: string; name: string; }

const ITEM_TYPES      = ['stock', 'service', 'bundle'];
const COSTING_METHODS = ['weighted_avg', 'fifo', 'standard'];

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem]               = useState<Item | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories]   = useState<Category[]>([]);
  const [uoms, setUoms]               = useState<UomRow[]>([]);
  const [accounts, setAccounts]       = useState<Account[]>([]);
  const [editing, setEditing]         = useState(false);
  const [form, setForm]               = useState<Partial<Item>>({});
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [saved, setSaved]             = useState(false);
  const [loading, setLoading]         = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<Item>(`/inventory/items/${id}`),
      api.get<{ transactions: Transaction[] }>(`/inventory/items/${id}/transactions`)
        .catch(() => ({ transactions: [] as Transaction[] })),
    ]).then(([it, txns]) => {
      setItem(it);
      setForm(it);
      setTransactions(txns.transactions);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    api.get<Category[]>(`/inventory/categories?company_id=${companyId}`).then(setCategories).catch(() => {});
    api.get<UomRow[]>(`/admin/uoms?company_id=${companyId}`).then(setUoms).catch(() => {});
    api.get<Account[]>(`/gl/accounts?company_id=${companyId}&active_only=true`).then(setAccounts).catch(() => {});
  }, []);

  function set(field: string, val: unknown) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await api.patch(`/inventory/items/${id}`, {
        sku: form.sku, name: form.name, uom: form.uom,
        item_type: form.item_type, costing_method: form.costing_method,
        standard_cost: Number(form.standard_cost),
        selling_price: Number(form.selling_price),
        reorder_point: Number(form.reorder_point),
        category_id: form.category_id || null,
        is_active: form.is_active,
        inventory_account_id: form.inventory_account_id || null,
        cogs_account_id: form.cogs_account_id || null,
        revenue_account_id: form.revenue_account_id || null,
        purchase_variance_account_id: form.purchase_variance_account_id || null,
      });
      setSaved(true); setEditing(false); load();
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!item)   return <div className="py-10 text-center text-sm text-red-600">Item not found</div>;

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

  const acctOpts = <>
    <option value="">— none —</option>
    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
  </>;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <Link href="/dashboard/inventory/items" className="text-xs text-slate-500 hover:underline">← Items</Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{item.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{item.sku} · {item.item_type} · {item.uom}</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Edit
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {editing ? (
        <form onSubmit={save} className="space-y-5">
          {/* Item Details */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
            <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Item Details</div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={lbl}>SKU *</label>
                <input required value={form.sku ?? ''} onChange={(e) => set('sku', e.target.value.toUpperCase())} className={inp} />
              </div>
              <div className="col-span-2">
                <label className={lbl}>Name *</label>
                <input required value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Item Type</label>
                <select value={form.item_type ?? 'stock'} onChange={(e) => set('item_type', e.target.value)} className={inp}>
                  {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>UOM</label>
                <select value={form.uom ?? 'PCS'} onChange={(e) => set('uom', e.target.value)} className={inp}>
                  {uoms.length > 0
                    ? uoms.map((u) => <option key={u.id} value={u.code}>{u.code} — {u.name}</option>)
                    : <option value={form.uom ?? 'PCS'}>{form.uom ?? 'PCS'}</option>}
                </select>
              </div>
              <div>
                <label className={lbl}>Category</label>
                <select value={form.category_id ?? ''} onChange={(e) => set('category_id', e.target.value || null)} className={inp}>
                  <option value="">— none —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Pricing & Costing */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
            <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Pricing & Costing</div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={lbl}>Costing Method</label>
                <select value={form.costing_method ?? 'weighted_avg'} onChange={(e) => set('costing_method', e.target.value)} className={inp}>
                  {COSTING_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Standard Cost</label>
                <input type="number" min={0} step="any" value={form.standard_cost ?? 0}
                  onChange={(e) => set('standard_cost', e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Selling Price</label>
                <input type="number" min={0} step="any" value={form.selling_price ?? 0}
                  onChange={(e) => set('selling_price', e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Reorder Point</label>
                <input type="number" min={0} step="any" value={form.reorder_point ?? 0}
                  onChange={(e) => set('reorder_point', e.target.value)} className={inp} />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={form.is_active ?? true} onChange={(e) => set('is_active', e.target.checked)} />
                  Active
                </label>
              </div>
            </div>
          </div>

          {/* Accounting Integration */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
            <div className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Accounting Integration</div>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Link GL accounts for automatic journal entry generation.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Inventory Account</label>
                <select value={form.inventory_account_id ?? ''} onChange={(e) => set('inventory_account_id', e.target.value || null)} className={inp}>
                  {acctOpts}
                </select>
              </div>
              <div>
                <label className={lbl}>COGS Account</label>
                <select value={form.cogs_account_id ?? ''} onChange={(e) => set('cogs_account_id', e.target.value || null)} className={inp}>
                  {acctOpts}
                </select>
              </div>
              <div>
                <label className={lbl}>Sales Revenue Account</label>
                <select value={form.revenue_account_id ?? ''} onChange={(e) => set('revenue_account_id', e.target.value || null)} className={inp}>
                  {acctOpts}
                </select>
              </div>
              <div>
                <label className={lbl}>Purchase Variance Account</label>
                <select value={form.purchase_variance_account_id ?? ''} onChange={(e) => set('purchase_variance_account_id', e.target.value || null)} className={inp}>
                  {acctOpts}
                </select>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={saving}
              className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setForm(item); setError(null); }}
              className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            {/* Item Details */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
              <div className="mb-3 text-xs font-medium text-slate-600 dark:text-slate-400">Item Details</div>
              <dl className="space-y-2 text-sm">
                {([
                  ['SKU', item.sku],
                  ['Name', item.name],
                  ['Type', item.item_type],
                  ['UOM', item.uom],
                  ['Category', item.category_name ?? '—'],
                  ['Status', item.is_active ? 'Active' : 'Inactive'],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-28 shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Pricing & Costing */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
              <div className="mb-3 text-xs font-medium text-slate-600 dark:text-slate-400">Pricing & Costing</div>
              <dl className="space-y-2 text-sm">
                {([
                  ['Costing Method', item.costing_method.replace('_', ' ')],
                  ['Standard Cost', formatPHP(item.standard_cost)],
                  ['Selling Price', formatPHP(item.selling_price)],
                  ['Reorder Point', String(item.reorder_point)],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-32 shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
                    <dd className="font-mono font-medium text-slate-900 dark:text-slate-100">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Accounting Integration — full width */}
            <div className="col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
              <div className="mb-3 text-xs font-medium text-slate-600 dark:text-slate-400">Accounting Integration</div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                {([
                  ['Inventory Account',        item.inventory_account_name],
                  ['COGS Account',             item.cogs_account_name],
                  ['Sales Revenue Account',    item.revenue_account_name],
                  ['Purchase Variance Account',item.purchase_variance_account_name],
                ] as [string, string | null][]).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-48 shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">{v ?? <span className="text-slate-400">—</span>}</dd>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              Recent Transactions
            </div>
            {transactions.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-400">No transactions found.</div>
            ) : (
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-left font-medium">Reference</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Party</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          t.txn_type === 'sale'     ? 'bg-blue-100 text-blue-700' :
                          t.txn_type === 'purchase' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{t.txn_type}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">{t.ref}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{t.txn_date ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{t.party_name}</td>
                      <td className={`px-3 py-2 text-right font-mono ${t.quantity < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                        {t.quantity > 0 ? '+' : ''}{t.quantity}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">{formatPHP(t.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
