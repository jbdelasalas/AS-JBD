'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { PortalHeader, PortalFooter } from '@/components/portal/PortalHeader';

type Product = { id: string; sku: string; name: string; uom: string; price: number; is_contracted: boolean };
type Line = { item_id: string; quantity: string };

const peso = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

export default function NewPortalOrder() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<Line[]>([{ item_id: '', quantity: '' }]);
  const [poRef, setPoRef] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ data: Product[] }>('/portal/products')
      .then((r) => setProducts(r.data))
      .catch((e) => setError((e as Error).message));
  }, []);

  const priceOf = (id: string) => products.find((p) => p.id === id)?.price ?? 0;
  const lineTotal = (l: Line) => priceOf(l.item_id) * (Number(l.quantity) || 0);
  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { item_id: '', quantity: '' }]);
  }
  function removeLine(i: number) {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const valid = lines.filter((l) => l.item_id && Number(l.quantity) > 0);
    if (!valid.length) {
      setError('Add at least one product with a quantity.');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<{ id: string }>('/portal/orders', {
        po_reference: poRef || undefined,
        delivery_date: deliveryDate || undefined,
        notes: notes || undefined,
        lines: valid.map((l) => ({ item_id: l.item_id, quantity: Number(l.quantity) })),
      });
      router.replace(`/portal/orders/${created.id}`);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to place order');
      setSaving(false);
    }
  }

  return (
    <>
      <PortalHeader subtitle="PLACE A NEW ORDER" backHref="/portal" backLabel="Back to Orders" />

      <main className="mx-auto max-w-3xl px-6 py-6">
        <h2 className="mb-1 text-lg font-bold text-[#1e2a44]">New Order</h2>
        <p className="mb-5 text-sm text-slate-500">
          Order at your contracted prices. Submitted orders start as <strong>Pending</strong> for approval.
        </p>

        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <form onSubmit={submit}>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">PO Reference (optional)</label>
                <input
                  value={poRef}
                  onChange={(e) => setPoRef(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#1e2a44] focus:outline-none"
                  placeholder="e.g. PO-88421"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Requested Delivery Date</label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#1e2a44] focus:outline-none"
                />
              </div>
            </div>

            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-400">Items</label>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const prod = products.find((p) => p.id === l.item_id);
                return (
                  <div key={i} className="grid grid-cols-12 items-center gap-2">
                    <select
                      value={l.item_id}
                      onChange={(e) => updateLine(i, { item_id: e.target.value })}
                      className="col-span-6 rounded border border-slate-300 px-2 py-2 text-sm focus:border-[#1e2a44] focus:outline-none"
                    >
                      <option value="">Select product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({peso(p.price)}/{p.uom})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={l.quantity}
                      onChange={(e) => updateLine(i, { quantity: e.target.value })}
                      placeholder={`Qty${prod ? ` (${prod.uom})` : ''}`}
                      className="col-span-3 rounded border border-slate-300 px-2 py-2 text-sm focus:border-[#1e2a44] focus:outline-none"
                    />
                    <div className="col-span-2 text-right text-sm font-medium text-slate-700">
                      {peso(lineTotal(l))}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="col-span-1 text-slate-400 hover:text-red-600"
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={addLine}
              className="mt-3 text-sm font-medium text-[#1e2a44] hover:underline"
            >
              + Add another item
            </button>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold text-slate-600">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#1e2a44] focus:outline-none"
                placeholder="Delivery instructions, etc."
              />
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
              <span className="text-sm font-semibold text-slate-600">Order Total</span>
              <span className="text-xl font-bold text-[#1e2a44]">{peso(grandTotal)}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="mt-5 w-full rounded-lg bg-[#c1121f] py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#a30f1a] disabled:opacity-50"
          >
            {saving ? 'Placing order…' : 'Place Order'}
          </button>
        </form>
      </main>

      <PortalFooter />
    </>
  );
}
