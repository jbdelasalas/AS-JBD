'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Customer { id: string; code: string; name: string; }
interface Item { id: string; sku: string; name: string; uom: string; selling_price: number; }
interface PriceRow {
  id: string;
  item_id: string;
  sku: string;
  item_name: string;
  uom: string;
  base_price: number;
  custom_price: number;
}

const peso = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

export default function PriceListPage() {
  const companyId = typeof window !== 'undefined' ? (localStorage.getItem('company_id') ?? '') : '';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [addItemId, setAddItemId] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ data: Customer[] }>(`/ar/customers?company_id=${companyId}&is_active=true&limit=500`),
      api.get<Item[]>(`/inventory/items?company_id=${companyId}&limit=500`),
    ]).then(([c, i]) => {
      setCustomers(c.data ?? []);
      setItems(i ?? []);
    }).catch((e) => setError((e as Error).message));
  }, [companyId]);

  function loadPrices(cid: string) {
    if (!cid) { setRows([]); return; }
    api.get<{ data: PriceRow[] }>(`/portal/price-list?company_id=${companyId}&customer_id=${cid}`)
      .then((r) => setRows(r.data))
      .catch((e) => setError((e as Error).message));
  }

  function onPickCustomer(cid: string) {
    setCustomerId(cid);
    setError(null);
    loadPrices(cid);
  }

  async function addPriceRow() {
    if (!customerId || !addItemId || !addPrice) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/portal/price-list', {
        company_id: companyId,
        customer_id: customerId,
        item_id: addItemId,
        custom_price: Number(addPrice),
      });
      setAddItemId('');
      setAddPrice('');
      loadPrices(customerId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(id: string) {
    setBusy(true);
    try {
      await api.delete(`/portal/price-list?id=${id}`);
      loadPrices(customerId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pricedItemIds = new Set(rows.map((r) => r.item_id));
  const addableItems = items.filter((i) => !pricedItemIds.has(i.id));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Customer Contracted Prices</h1>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">
        Set per-customer prices used by the customer portal. Products without a contracted price fall back to the item&apos;s base selling price.
      </p>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Customer</label>
        <select
          value={customerId}
          onChange={(e) => onPickCustomer(e.target.value)}
          className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="">Select customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
          ))}
        </select>
      </div>

      {customerId && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="pb-2">Product</th>
                <th className="pb-2 text-right">Base Price</th>
                <th className="pb-2 text-right">Contracted Price</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="py-4 text-center text-xs text-slate-400">No contracted prices yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-2 text-slate-700 dark:text-slate-300">{r.sku} — {r.item_name}</td>
                  <td className="py-2 text-right text-slate-500">{peso(r.base_price)}</td>
                  <td className="py-2 text-right font-medium text-slate-800 dark:text-slate-200">{peso(r.custom_price)}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => removeRow(r.id)} disabled={busy}
                      className="text-slate-400 hover:text-red-600 disabled:opacity-40">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Add row */}
          <div className="mt-4 flex items-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Product</label>
              <select value={addItemId} onChange={(e) => setAddItemId(e.target.value)}
                className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select product…</option>
                {addableItems.map((i) => (
                  <option key={i.id} value={i.id}>{i.sku} — {i.name} (base {peso(Number(i.selling_price))})</option>
                ))}
              </select>
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Price</label>
              <input type="number" min="0" step="any" value={addPrice} onChange={(e) => setAddPrice(e.target.value)}
                className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <button onClick={addPriceRow} disabled={busy || !addItemId || !addPrice}
              className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
