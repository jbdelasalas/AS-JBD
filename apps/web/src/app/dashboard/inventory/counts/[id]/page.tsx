'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface CountLine {
  id: string;
  item_id: string;
  sku: string;
  item_name: string;
  uom: string;
  system_qty: number;
  counted_qty: number;
  variance: number;
  unit_cost: number;
  variance_value: number;
}

interface StockCount {
  id: string;
  count_no: string;
  count_type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  posted_at: string | null;
  je_id: string | null;
  warehouse_name: string;
  created_by_name: string;
  notes: string | null;
  lines: CountLine[];
}

const STATUS_STYLES: Record<string, string> = {
  draft:       'bg-slate-100 text-slate-700',
  in_progress: 'bg-amber-100 text-amber-700',
  posted:      'bg-emerald-100 text-emerald-700',
  voided:      'bg-red-100 text-red-700',
};

export default function StockCountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [cnt, setCnt] = useState<StockCount | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get<StockCount>(`/inventory/counts/${id}`)
      .then((c) => {
        setCnt(c);
        // Pre-populate edits with existing counted_qty
        const init: Record<string, string> = {};
        for (const l of c.lines) init[l.id] = String(l.counted_qty);
        setEdits(init);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function saveCountedQtys() {
    setSaving(true);
    setError(null);
    try {
      const updates = Object.entries(edits).map(([line_id, counted_qty]) => ({
        line_id,
        counted_qty: Number(counted_qty),
      }));
      await api.patch(`/inventory/counts/${id}`, { lines: updates });
      load();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function doAction(action: 'post' | 'void') {
    setActing(true);
    setError(null);
    try {
      await api.post(`/inventory/counts/${id}/${action}`, {});
      load();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Action failed');
    } finally {
      setActing(false);
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  if (!cnt) return <div className="py-8 text-center text-sm text-red-600">{error ?? 'Not found'}</div>;

  const totalVarianceValue = cnt.lines.reduce((s, l) => {
    const counted = Number(edits[l.id] ?? l.counted_qty);
    return s + (counted - l.system_qty) * l.unit_cost;
  }, 0);
  const canEdit = cnt.status === 'in_progress';

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{cnt.count_no}</h1>
            <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[cnt.status] ?? STATUS_STYLES.draft}`}>
              {cnt.status.replace(/_/g, ' ')}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">{cnt.count_type}</span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">{cnt.warehouse_name}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.back()}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
            Back
          </button>
          {canEdit && (
            <>
              <button onClick={saveCountedQtys} disabled={saving}
                className="rounded border border-brand-300 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save counts'}
              </button>
              <button onClick={() => doAction('post')} disabled={acting}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                Post
              </button>
              <button onClick={() => doAction('void')} disabled={acting}
                className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                Void
              </button>
            </>
          )}
          {cnt.je_id && (
            <Link href={`/dashboard/gl/journal-entries/${cnt.je_id}`}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              View Journal Entry
            </Link>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <InfoCard label="Warehouse" value={cnt.warehouse_name} />
        <InfoCard label="Started" value={cnt.started_at ? formatDate(cnt.started_at) : '—'} />
        <InfoCard label="Posted" value={cnt.posted_at ? formatDate(cnt.posted_at) : '—'} />
        <InfoCard label="Created by" value={cnt.created_by_name} />
        <InfoCard label="Total variance value" value={
          `${totalVarianceValue >= 0 ? '+' : ''}${totalVarianceValue.toFixed(2)}`
        } />
        <InfoCard label="Notes" value={cnt.notes ?? '—'} />
      </div>

      {canEdit && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Enter the physical counted quantities below, then click <strong>Save counts</strong>. When done, click <strong>Post</strong> to apply variances to stock.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">SKU</th>
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-left font-medium">UOM</th>
              <th className="px-3 py-2 text-right font-medium">System Qty</th>
              <th className="px-3 py-2 text-right font-medium">Counted Qty</th>
              <th className="px-3 py-2 text-right font-medium">Variance</th>
              <th className="px-3 py-2 text-right font-medium">Variance Value</th>
            </tr>
          </thead>
          <tbody>
            {cnt.lines.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">No items in count.</td></tr>
            ) : cnt.lines.map((l) => {
              const counted = Number(edits[l.id] ?? l.counted_qty);
              const variance = counted - l.system_qty;
              const varValue = variance * l.unit_cost;
              return (
                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{l.sku}</td>
                  <td className="px-3 py-2 text-slate-900 dark:text-slate-100">{l.item_name}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{l.uom}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-700 dark:text-slate-300">{l.system_qty.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    {canEdit ? (
                      <input
                        type="number" step="0.0001" min="0"
                        value={edits[l.id] ?? '0'}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        className="w-24 rounded border border-slate-300 px-2 py-0.5 text-right text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    ) : (
                      <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{l.counted_qty.toLocaleString()}</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono text-xs font-medium ${variance < 0 ? 'text-red-600' : variance > 0 ? 'text-emerald-600' : 'text-slate-500 dark:text-slate-400'}`}>
                    {variance !== 0 ? `${variance > 0 ? '+' : ''}${variance.toFixed(4)}` : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono text-xs ${varValue < 0 ? 'text-red-600' : varValue > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {varValue !== 0 ? `${varValue > 0 ? '+' : ''}${varValue.toFixed(2)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {cnt.lines.length > 0 && (
            <tfoot className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <tr>
                <td colSpan={6} className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Total variance value</td>
                <td className={`px-3 py-2 text-right font-mono text-xs font-bold ${totalVarianceValue < 0 ? 'text-red-600' : totalVarianceValue > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {totalVarianceValue !== 0 ? `${totalVarianceValue > 0 ? '+' : ''}${totalVarianceValue.toFixed(2)}` : '—'}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}
