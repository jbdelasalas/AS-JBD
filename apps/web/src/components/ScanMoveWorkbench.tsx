'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import QrScanner from '@/components/QrScanner';

// Two-step floor workflow: scan what you're moving, then scan where it goes.
// The destination scan commits immediately — on a cold floor with gloves on,
// an extra confirm tap is friction, and the move is fully reversible by
// scanning the item back to its old bin.
//
// Shared by Warehouse and the Dressing Plant: both floors move the same boxes
// and pallets between the same bins, so they get the same workbench rather than
// two drifting copies. Only the wording differs.

interface ResolvedBin {
  id: string; code: string; zone: string | null; bin_type: string;
  warehouse_name: string; qty_on_hand: string; box_count: number;
}
interface ResolvedBox {
  id: string; product: string; net_weight_kg: string; status: string;
  bin_code: string | null; warehouse_name: string | null; pallet_no: string | null;
  batch_no: string | null; lot_no: string | null;
}
interface ResolvedPallet {
  id: string; pallet_no: string; status: string; bin_code: string | null;
  warehouse_name: string | null; box_count: number; net_weight_kg: string;
}
interface Resolved {
  code: string; entity_type: 'bin' | 'box' | 'pallet';
  bin?: ResolvedBin; box?: ResolvedBox; pallet?: ResolvedPallet;
  boxes?: { id: string; product: string; net_weight_kg: string }[];
}
interface HistoryRow {
  id: string; entity_type: string; code: string | null; qty: string;
  scanned_at: string; from_bin_code: string | null; to_bin_code: string | null;
  scanned_by_name: string | null; item_name: string | null;
}

type Feedback = { kind: 'ok' | 'error' | 'info'; text: string } | null;

export interface ScanMoveWorkbenchProps {
  /** Sub-heading under the page title. */
  subtitle?: string;
}

export default function ScanMoveWorkbench({
  subtitle = 'Scan a box or pallet, then scan the destination bin.',
}: ScanMoveWorkbenchProps) {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [source, setSource] = useState<Resolved | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => { setCompanyId(localStorage.getItem('company_id')); }, []);

  const loadHistory = useCallback((cid: string) => {
    api.get<{ data: HistoryRow[] }>(`/wms/scan/move?company_id=${cid}&limit=15`)
      .then((r) => setHistory(r.data)).catch(() => {});
  }, []);

  useEffect(() => { if (companyId) loadHistory(companyId); }, [companyId, loadHistory]);

  // Short vibration on success/failure — the only feedback that reliably lands
  // in a noisy plant where the screen may not be visible.
  const buzz = (pattern: number | number[]) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(pattern);
  };

  const handleScan = useCallback(async (raw: string) => {
    if (!companyId) { setFeedback({ kind: 'error', text: 'No company selected.' }); return; }
    setBusy(true);
    try {
      const resolved = await api.get<Resolved>(
        `/wms/scan/resolve?company_id=${companyId}&code=${encodeURIComponent(raw)}`,
      );

      // A bin scan while holding something = the destination: commit the move.
      if (resolved.entity_type === 'bin' && source) {
        const res = await api.post<{ to_bin: { code: string }; boxes: number; qty: number }>(
          '/wms/scan/move',
          { company_id: companyId, code: source.code, to_bin_code: resolved.code },
        );
        buzz(60);
        const what = source.entity_type === 'pallet'
          ? `Pallet ${source.pallet?.pallet_no} (${res.boxes} box${res.boxes === 1 ? '' : 'es'})`
          : `Box ${source.box?.product ?? ''}`.trim();
        setFeedback({ kind: 'ok', text: `${what} → ${res.to_bin.code}` });
        setSource(null);
        loadHistory(companyId);
        return;
      }

      if (resolved.entity_type === 'bin') {
        setFeedback({ kind: 'info', text: `Bin ${resolved.bin?.code} — scan a box or pallet first, then this bin.` });
        setSource(null);
        return;
      }

      setSource(resolved);
      setFeedback({ kind: 'info', text: 'Now scan the destination bin.' });
    } catch (e) {
      buzz([40, 60, 40]);
      setFeedback({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [companyId, source, loadHistory]);

  const held = source && (
    source.entity_type === 'box'
      ? {
          title: source.box?.product ?? 'Box',
          lines: [
            `${source.box?.net_weight_kg ?? '0'} kg`,
            source.box?.lot_no ? `Lot ${source.box.lot_no}` : null,
            source.box?.batch_no ? `Batch ${source.box.batch_no}` : null,
            source.box?.pallet_no ? `On pallet ${source.box.pallet_no}` : null,
            `Now in: ${source.box?.bin_code ?? 'not yet binned'}`,
          ].filter(Boolean) as string[],
        }
      : {
          title: `Pallet ${source.pallet?.pallet_no ?? ''}`,
          lines: [
            `${source.pallet?.box_count ?? 0} boxes · ${source.pallet?.net_weight_kg ?? '0'} kg`,
            `Now in: ${source.pallet?.bin_code ?? 'not yet binned'}`,
          ],
        }
  );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Scan &amp; Move</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
        </div>
        <Link
          href="/dashboard/wms/labels"
          className="shrink-0 rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Print labels
        </Link>
      </div>

      {/* Step indicator — which half of the two-scan flow we're in. */}
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-medium ${!source ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
          1 · Scan item
        </span>
        <span className="text-slate-300 dark:text-slate-600">→</span>
        <span className={`rounded-full px-2.5 py-1 font-medium ${source ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
          2 · Scan bin
        </span>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <QrScanner
          onScan={handleScan}
          busy={busy}
          autoFocus
          placeholder={source ? 'Scan destination bin…' : 'Scan a box or pallet…'}
        />
      </div>

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            feedback.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : feedback.kind === 'error' ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {held && (
        <div className="mt-3 rounded-lg border-2 border-brand-500 bg-brand-50/60 p-4 dark:bg-brand-950/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-brand-700 dark:text-brand-400">Holding</p>
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{held.title}</p>
              {held.lines.map((l) => (
                <p key={l} className="text-xs text-slate-600 dark:text-slate-400">{l}</p>
              ))}
            </div>
            <button
              onClick={() => { setSource(null); setFeedback(null); }}
              className="shrink-0 rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Recent movements</h2>
        {history.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">Nothing moved yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 bg-white px-3 py-2 text-xs dark:bg-slate-900">
                <div className="min-w-0">
                  <p className="truncate text-slate-800 dark:text-slate-200">
                    <span className="capitalize">{h.entity_type}</span>
                    {h.item_name ? ` · ${h.item_name}` : ''}
                    {Number(h.qty) > 0 ? ` · ${Number(h.qty)} kg` : ''}
                  </p>
                  <p className="truncate text-slate-500 dark:text-slate-400">
                    {h.from_bin_code ?? '—'} → {h.to_bin_code ?? '—'}
                    {h.scanned_by_name ? ` · ${h.scanned_by_name}` : ''}
                  </p>
                </div>
                <time className="shrink-0 text-slate-400" dateTime={h.scanned_at}>
                  {new Date(h.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
