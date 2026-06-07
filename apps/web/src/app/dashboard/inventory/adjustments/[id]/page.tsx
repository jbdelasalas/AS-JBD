'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface AdjLine {
  id: string;
  line_no: number;
  item_id: string;
  sku: string;
  item_name: string;
  uom: string;
  qty_change: number;
  unit_cost: number;
  line_total: number;
  notes: string | null;
}

interface Adjustment {
  id: string;
  adj_no: string;
  reason_code: string;
  status: string;
  created_at: string;
  posted_at: string | null;
  je_id: string | null;
  warehouse_name: string;
  created_by_name: string;
  notes: string | null;
  lines: AdjLine[];
}

const STATUS_STYLES: Record<string, string> = {
  draft:  'bg-slate-100 text-slate-700',
  posted: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

export default function AdjustmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [adj, setAdj] = useState<Adjustment | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Adjustment>(`/inventory/adjustments/${id}`)
      .then(setAdj)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function doAction(action: 'post' | 'void') {
    setActing(true);
    setError(null);
    try {
      await api.post(`/inventory/adjustments/${id}/${action}`, {});
      load();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Action failed');
    } finally {
      setActing(false);
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  if (!adj) return <div className="py-8 text-center text-sm text-red-600">{error ?? 'Not found'}</div>;

  const totalQtyChange = adj.lines.reduce((s, l) => s + l.qty_change, 0);
  const totalValue = adj.lines.reduce((s, l) => s + l.line_total, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{adj.adj_no}</h1>
            <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[adj.status] ?? STATUS_STYLES.draft}`}>
              {adj.status}
            </span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">Stock adjustment · {adj.reason_code.replace(/_/g, ' ')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.back()}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
            Back
          </button>
          {adj.status === 'draft' && (
            <>
              <button onClick={() => doAction('post')} disabled={acting}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                Post
              </button>
            </>
          )}
          {adj.status === 'posted' && (
            <button onClick={() => doAction('void')} disabled={acting}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              Void
            </button>
          )}
          {adj.je_id && (
            <Link href={`/dashboard/gl/journal-entries/${adj.je_id}`}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              View Journal Entry
            </Link>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <InfoCard label="Warehouse" value={adj.warehouse_name} />
        <InfoCard label="Created" value={formatDate(adj.created_at)} />
        <InfoCard label="Posted" value={adj.posted_at ? formatDate(adj.posted_at) : '—'} />
        <InfoCard label="Created by" value={adj.created_by_name} />
        <InfoCard label="Reason" value={adj.reason_code.replace(/_/g, ' ')} />
        <InfoCard label="Notes" value={adj.notes ?? '—'} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">SKU</th>
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-left font-medium">UOM</th>
              <th className="px-3 py-2 text-right font-medium">Qty Change</th>
              <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-3 py-2 text-left font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {adj.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{l.sku}</td>
                <td className="px-3 py-2 text-slate-900 dark:text-slate-100">{l.item_name}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{l.uom}</td>
                <td className={`px-3 py-2 text-right font-mono text-xs font-medium ${l.qty_change < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {l.qty_change > 0 ? '+' : ''}{l.qty_change}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-700 dark:text-slate-300">{l.unit_cost.toFixed(4)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-900 dark:text-slate-100">{l.line_total.toFixed(2)}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Totals</td>
              <td className={`px-3 py-2 text-right font-mono text-xs font-bold ${totalQtyChange < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {totalQtyChange > 0 ? '+' : ''}{totalQtyChange.toFixed(4)}
              </td>
              <td />
              <td className="px-3 py-2 text-right font-mono text-xs font-bold text-slate-900 dark:text-slate-100">{totalValue.toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
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
