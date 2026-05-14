'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface TransferLine {
  id: string;
  line_no: number;
  item_id: string;
  sku: string;
  item_name: string;
  uom: string;
  qty: number;
  unit_cost_at_send: number | null;
}

interface Transfer {
  id: string;
  transfer_no: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
  from_warehouse_name: string;
  to_warehouse_name: string;
  created_by_name: string;
  notes: string | null;
  lines: TransferLine[];
}

const STATUS_STYLES: Record<string, string> = {
  draft:      'bg-slate-100 text-slate-700',
  in_transit: 'bg-amber-100 text-amber-700',
  received:   'bg-emerald-100 text-emerald-700',
  cancelled:  'bg-red-100 text-red-700',
};

export default function TransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [xfr, setXfr] = useState<Transfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Transfer>(`/inventory/transfers/${id}`)
      .then(setXfr)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function doAction(action: 'send' | 'receive' | 'cancel') {
    setActing(true);
    setError(null);
    try {
      await api.post(`/inventory/transfers/${id}/${action}`, {});
      load();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Action failed');
    } finally {
      setActing(false);
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  if (!xfr) return <div className="py-8 text-center text-sm text-red-600">{error ?? 'Not found'}</div>;

  const totalQty = xfr.lines.reduce((s, l) => s + l.qty, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{xfr.transfer_no}</h1>
            <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[xfr.status] ?? STATUS_STYLES.draft}`}>
              {xfr.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {xfr.from_warehouse_name} → {xfr.to_warehouse_name}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.back()}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
            Back
          </button>
          {xfr.status === 'draft' && (
            <>
              <button onClick={() => doAction('send')} disabled={acting}
                className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                Send (dispatch)
              </button>
              <button onClick={() => doAction('cancel')} disabled={acting}
                className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                Cancel
              </button>
            </>
          )}
          {xfr.status === 'in_transit' && (
            <>
              <button onClick={() => doAction('receive')} disabled={acting}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                Mark Received
              </button>
              <button onClick={() => doAction('cancel')} disabled={acting}
                className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <InfoCard label="From" value={xfr.from_warehouse_name} />
        <InfoCard label="To" value={xfr.to_warehouse_name} />
        <InfoCard label="Created" value={formatDate(xfr.created_at)} />
        <InfoCard label="Sent" value={xfr.sent_at ? formatDate(xfr.sent_at) : '—'} />
        <InfoCard label="Received" value={xfr.received_at ? formatDate(xfr.received_at) : '—'} />
        <InfoCard label="Notes" value={xfr.notes ?? '—'} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">SKU</th>
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-left font-medium">UOM</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Cost at Send</th>
            </tr>
          </thead>
          <tbody>
            {xfr.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{l.sku}</td>
                <td className="px-3 py-2 text-slate-900 dark:text-slate-100">{l.item_name}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{l.uom}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-medium text-slate-900 dark:text-slate-100">{l.qty.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                  {l.unit_cost_at_send != null ? l.unit_cost_at_send.toFixed(4) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Total</td>
              <td className="px-3 py-2 text-right font-mono text-xs font-bold text-slate-900 dark:text-slate-100">{totalQty.toLocaleString()}</td>
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
