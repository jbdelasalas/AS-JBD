'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Category  { id: string; name: string; }
interface UomRow    { id: string; code: string; name: string; }
interface Account   { id: string; code: string; name: string; account_type: string; }
interface Warehouse { id: string; code: string; name: string; }

const ITEM_TYPES = ['stock', 'service', 'bundle'];
const COSTING_METHODS = ['weighted_avg', 'fifo', 'standard'];

export default function NewItemPage() {
  const router = useRouter();
  const [categories, setCategories]   = useState<Category[]>([]);
  const [uoms, setUoms]               = useState<UomRow[]>([]);
  const [accounts, setAccounts]       = useState<Account[]>([]);
  const [warehouses, setWarehouses]   = useState<Warehouse[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    sku: '', name: '', uom: 'PCS', item_type: 'stock',
    costing_method: 'weighted_avg', standard_cost: '', selling_price: '',
    reorder_point: '', category_id: '', is_active: true,
    inventory_account_id: '',
    cogs_account_id: '',
    revenue_account_id: '',
    purchase_variance_account_id: '',
    location_id: '',
    default_warehouse_id: '',
  });

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    api.get<Category[]>(`/inventory/categories?company_id=${companyId}`).then(setCategories).catch(() => {});
    api.get<UomRow[]>(`/admin/uoms?company_id=${companyId}`).then(setUoms).catch(() => {});
    api.get<Account[]>(`/gl/accounts?company_id=${companyId}&active_only=true`).then(setAccounts).catch(() => {});
    api.get<Warehouse[]>(`/inventory/locations?company_id=${companyId}`).then(setWarehouses).catch(() => {});
  }, []);

  function set(field: string, val: unknown) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const companyId = localStorage.getItem('company_id')!;
      await api.post('/inventory/items', {
        company_id: companyId,
        sku: form.sku, name: form.name, uom: form.uom,
        item_type: form.item_type, costing_method: form.costing_method,
        standard_cost: parseFloat(form.standard_cost) || 0,
        selling_price: parseFloat(form.selling_price) || 0,
        reorder_point: parseFloat(form.reorder_point) || 0,
        category_id: form.category_id || undefined,
        is_active: form.is_active,
        inventory_account_id: form.inventory_account_id || null,
        cogs_account_id: form.cogs_account_id || null,
        revenue_account_id: form.revenue_account_id || null,
        purchase_variance_account_id: form.purchase_variance_account_id || null,
        default_warehouse_id: form.default_warehouse_id || null,
      });
      router.push('/dashboard/inventory/items');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create item');
    } finally {
      setSaving(false);
    }
  }

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

  const accountOptions = (
    <option value="">— none —</option>
  );

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Item</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Create a new inventory item or service.</p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Item Details */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Item Details</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={lbl}>SKU *</label>
              <input required value={form.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())}
                placeholder="ITEM-001" className={inp} />
            </div>
            <div className="col-span-2">
              <label className={lbl}>Name *</label>
              <input required value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="Item description" className={inp} />
            </div>
            <div>
              <label className={lbl}>Item Type *</label>
              <select required value={form.item_type} onChange={(e) => set('item_type', e.target.value)} className={inp}>
                {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Unit of Measure *</label>
              <select required value={form.uom} onChange={(e) => set('uom', e.target.value)} className={inp}>
                {uoms.length > 0
                  ? uoms.map((u) => <option key={u.id} value={u.code}>{u.code} — {u.name}</option>)
                  : <option value="PCS">PCS</option>}
              </select>
            </div>
            <div>
              <label className={lbl}>Category</label>
              <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)} className={inp}>
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
              <select value={form.costing_method} onChange={(e) => set('costing_method', e.target.value)} className={inp}>
                {COSTING_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Standard Cost</label>
              <input type="number" min={0} step="any" value={form.standard_cost}
                onChange={(e) => set('standard_cost', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Selling Price</label>
              <input type="number" min={0} step="any" value={form.selling_price}
                onChange={(e) => set('selling_price', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Reorder Point</label>
              <input type="number" min={0} step="any" value={form.reorder_point}
                onChange={(e) => set('reorder_point', e.target.value)} className={inp} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
                Active
              </label>
            </div>
          </div>
        </div>

        {/* Location & Warehouse */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <div className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Location / Warehouse</div>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            Select a location — the warehouse is set to the same value automatically. You can override it if needed.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Location</label>
              <select
                value={form.location_id}
                onChange={(e) => {
                  const val = e.target.value;
                  set('location_id', val);
                  set('default_warehouse_id', val); // auto-sync
                }}
                className={inp}
              >
                <option value="">— none —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Warehouse</label>
              <select
                value={form.default_warehouse_id}
                onChange={(e) => set('default_warehouse_id', e.target.value)}
                className={inp}
              >
                <option value="">— none —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
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
              <select value={form.inventory_account_id} onChange={(e) => set('inventory_account_id', e.target.value)} className={inp}>
                {accountOptions}
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>COGS Account</label>
              <select value={form.cogs_account_id} onChange={(e) => set('cogs_account_id', e.target.value)} className={inp}>
                {accountOptions}
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Sales Revenue Account</label>
              <select value={form.revenue_account_id} onChange={(e) => set('revenue_account_id', e.target.value)} className={inp}>
                {accountOptions}
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Purchase Variance Account</label>
              <select value={form.purchase_variance_account_id} onChange={(e) => set('purchase_variance_account_id', e.target.value)} className={inp}>
                {accountOptions}
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Item'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
