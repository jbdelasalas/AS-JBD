'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

interface DRLine {
  id: string; line_no: number; item_id: string; item_name: string | null; item_sku: string | null;
  description: string; qty_delivered: number; unit_cost: number;
  so_unit_price: number | null; so_vat_rate: number | null; so_discount_pct: number | null;
}
interface DR {
  id: string; dr_no: string; delivery_date: string; customer_id: string; customer_name: string;
  status: string; lines: DRLine[];
}

interface ReturnLine {
  dr_line_id: string; item_id: string; description: string;
  qty_delivered: number; qty_return: number; unit_cost: number; unit_price: number;
  vat_rate: number; discount_pct: number; item_name: string | null;
}

const lbl = 'mb-0.5 block text-xs font-medium text-brand-600 dark:text-brand-400';
const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:border-brand-500';

export default function NewReturnGoodsPage() {
  const router      = useRouter();
  const searchParams = useSearchParams();
  const drId        = searchParams.get('dr_id') ?? '';

  const [dr, setDr]         = useState<DR | null>(null);
  const [loading, setLoading] = useState(false);
  const [returnDate, setReturnDate] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines]   = useState<ReturnLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState<string | null>(null);

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (!drId) return;
    setLoading(true);
    api.get<DR>(`/sales/delivery-receipts/${drId}`)
      .then(d => {
        setDr(d);
        setReturnDate(today);
        setLines(d.lines.map(l => ({
          dr_line_id:   l.id,
          item_id:      l.item_id,
          description:  l.description,
          qty_delivered: l.qty_delivered,
          qty_return:   0,
          unit_cost:    l.unit_cost,
          unit_price:   l.so_unit_price ?? 0,
          vat_rate:     l.so_vat_rate ?? 0,
          discount_pct: l.so_discount_pct ?? 0,
          item_name:    l.item_name,
        })));
      })
      .catch(e => setMsg((e as Error).message))
      .finally(() => setLoading(false));
  }, [drId, today]);

  function setQty(i: number, v: number) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qty_return: v } : l));
  }

  async function save() {
    const companyId = localStorage.getItem('company_id');
    if (!companyId || !dr) return;
    const activeLines = lines.filter(l => l.qty_return > 0);
    if (!activeLines.length) { setMsg('Enter a return quantity for at least one line'); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await api.post<{ id: string; return_no: string }>(
        '/sales/return-goods',
        { company_id: companyId, dr_id: dr.id, return_date: returnDate, reason, lines: activeLines },
      );
      router.push(`/dashboard/sales/return-goods/${res.id}`);
    } catch (e: unknown) { setMsg((e as Error).message ?? 'Save failed'); }
    finally { setSaving(false); }
  }

  if (!drId) return (
    <div className="py-12 text-center text-sm text-slate-500">
      No DR selected. Open a posted Delivery Receipt and click &quot;Create Return&quot;.
    </div>
  );

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading DR…</div>;
  if (!dr) return <div className="py-12 text-center text-sm text-red-600">DR not found.</div>;

  const totalReturnRevenue = lines.reduce((s, l) => s + l.qty_return * l.unit_price, 0);
  const totalReturnCost    = lines.reduce((s, l) => s + l.qty_return * l.unit_cost,  0);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">New Return Goods</h1>
          <p className="text-xs text-slate-500">From DR: <span className="font-medium text-brand-700 dark:text-brand-400">{dr.dr_no}</span> — {dr.customer_name}</p>
        </div>
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-xl">←</button>
      </div>

      {msg && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{msg}</div>}

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className={lbl}>Return Date *</label>
            <input type="date" className={inp} value={returnDate} onChange={e => setReturnDate(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>DR Reference</label>
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {dr.dr_no} — {new Date(dr.delivery_date).toLocaleDateString('en-PH')}
            </div>
          </div>
          <div className="col-span-2">
            <label className={lbl}>Reason for Return</label>
            <input className={inp} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Damaged goods, wrong item…" />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Return Lines</h2>
          <p className="text-xs text-slate-400 mt-0.5">Enter KGS to return for each item (leave 0 to skip)</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Item</th>
                <th className="px-4 py-2 text-right">Delivered (KGS)</th>
                <th className="px-4 py-2 text-right">Unit Cost</th>
                <th className="px-4 py-2 text-right">Unit Price</th>
                <th className="px-4 py-2 text-right w-36">Return (KGS) *</th>
                <th className="px-4 py-2 text-right">Return Revenue</th>
                <th className="px-4 py-2 text-right">Return Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {lines.map((l, i) => (
                <tr key={i} className={l.qty_return > 0 ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}>
                  <td className="px-4 py-2 text-slate-400 text-xs">{i + 1}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800 dark:text-slate-200">{l.item_name ?? l.description}</div>
                    <div className="text-xs text-slate-400">{l.description}</div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-600 dark:text-slate-300">{Number(l.qty_delivered).toFixed(4)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-600 dark:text-slate-300">₱{Number(l.unit_cost).toLocaleString('en-PH', { minimumFractionDigits: 4 })}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-600 dark:text-slate-300">₱{Number(l.unit_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-2 text-right">
                    <input type="number" min={0} step="any" max={l.qty_delivered}
                      value={l.qty_return || ''}
                      onChange={e => setQty(i, parseFloat(e.target.value) || 0)}
                      placeholder="0.0000"
                      className="w-32 rounded border border-slate-300 px-2 py-1 text-right text-sm font-mono dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-sm text-slate-700 dark:text-slate-300">
                    {l.qty_return > 0 ? `₱${(l.qty_return * l.unit_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-sm text-slate-700 dark:text-slate-300">
                    {l.qty_return > 0 ? `₱${(l.qty_return * l.unit_cost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800">
              <tr>
                <td colSpan={6} className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Totals</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                  ₱{totalReturnRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                  ₱{totalReturnCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={save} disabled={saving}
          className="rounded bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Return'}
        </button>
        <button onClick={() => router.back()}
          className="rounded border border-slate-300 px-6 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
          Cancel
        </button>
      </div>
    </div>
  );
}
