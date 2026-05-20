'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

export interface JournalLine {
  account_code: string;
  account_name: string;
  description: string;
  debit: number;
  credit: number;
}

export interface JournalPreview {
  entry_date: string;
  reference: string;
  memo: string;
  lines: JournalLine[];
  total_debit: number;
  total_credit: number;
  is_balanced: boolean;
  warnings: string[];
}

interface Props {
  previewUrl: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function JournalPreviewModal({
  previewUrl,
  confirmLabel = 'Confirm',
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const [preview, setPreview] = useState<JournalPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<JournalPreview>(previewUrl)
      .then(setPreview)
      .catch((e) => setError((e as Error).message ?? 'Failed to load preview'))
      .finally(() => setLoading(false));
  }, [previewUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[90vh] w-[640px] flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        {/* Header */}
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Journal Entry Preview</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Review the accounting entries before posting.</p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading preview…</div>
          )}
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {preview && (
            <>
              {/* Meta */}
              <div className="mb-4 grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Entry Date</div>
                  <div className="mt-0.5 text-xs font-medium text-slate-900 dark:text-slate-100">{formatDate(preview.entry_date)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Reference</div>
                  <div className="mt-0.5 text-xs font-medium text-slate-900 dark:text-slate-100">{preview.reference}</div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Memo</div>
                  <div className="mt-0.5 truncate text-xs font-medium text-slate-900 dark:text-slate-100">{preview.memo}</div>
                </div>
              </div>

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}

              {/* Lines */}
              <div className="mb-3 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Account</th>
                      <th className="px-3 py-2 text-left font-medium">Description</th>
                      <th className="px-3 py-2 text-right font-medium w-28">Debit</th>
                      <th className="px-3 py-2 text-right font-medium w-28">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((l, i) => (
                      <tr key={i} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="px-3 py-2">
                          <div className="font-mono font-semibold text-slate-700 dark:text-slate-300">{l.account_code}</div>
                          <div className="text-slate-500 dark:text-slate-400">{l.account_name}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{l.description}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">
                          {l.debit > 0 ? formatPHP(l.debit) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">
                          {l.credit > 0 ? formatPHP(l.credit) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold dark:border-slate-600 dark:bg-slate-800">
                      <td colSpan={2} className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">Total</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900 dark:text-slate-100">{formatPHP(preview.total_debit)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900 dark:text-slate-100">{formatPHP(preview.total_credit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Balance indicator */}
              <div className={`rounded px-3 py-2 text-center text-xs font-medium ${
                preview.is_balanced
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
              }`}>
                {preview.is_balanced ? '✓ Entry is balanced' : '✗ Entry is unbalanced — posting is blocked'}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <button
            disabled={busy || loading || !!error || !preview?.is_balanced}
            onClick={onConfirm}
            className="flex-1 rounded bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
            {busy ? 'Processing…' : confirmLabel}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded border border-slate-300 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
