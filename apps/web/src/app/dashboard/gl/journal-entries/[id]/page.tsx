'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import type { JournalEntry } from '@perpet/shared';

export default function JournalEntryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const data = await api.get<JournalEntry>(`/gl/journal-entries/${params.id}`);
      setEntry(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (params.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function postEntry() {
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/gl/journal-entries/${entry.id}/post`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post');
    } finally {
      setBusy(false);
    }
  }

  async function voidEntry() {
    if (!entry) return;
    const reason = prompt('Reason for voiding (minimum 5 characters):');
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/gl/journal-entries/${entry.id}/void`, { reason });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to void');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-sm text-slate-500 dark:text-slate-400">Loading...</div>;
  if (!entry) return <div className="text-sm text-red-700">{error ?? 'Entry not found'}</div>;

  const totalDebit  = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <Link href="/dashboard/gl/journal-entries" className="text-xs text-brand-700 hover:underline">
          ← Back to journal entries
        </Link>
      </div>

      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{entry.entry_no}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {formatDate(entry.entry_date)} ·{' '}
            <span
              className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${
                entry.status === 'posted' ? 'bg-emerald-100 text-emerald-700'
                : entry.status === 'voided' ? 'bg-red-100 text-red-700'
                : 'bg-slate-100 text-slate-700 dark:text-slate-300'
              }`}
            >
              {entry.status}
            </span>
          </p>
        </div>

        <div className="flex gap-2">
          {entry.status === 'draft' && (
            <button
              onClick={postEntry}
              disabled={busy}
              className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Post
            </button>
          )}
          {(entry.status === 'draft' || entry.status === 'posted') && (
            <button
              onClick={voidEntry}
              disabled={busy}
              className="rounded border border-red-300 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Void
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-xs">
        <div>
          <span className="text-slate-500 dark:text-slate-400">Reference: </span>
          <span className="text-slate-900 dark:text-slate-100">{entry.reference || '—'}</span>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">Memo: </span>
          <span className="text-slate-900 dark:text-slate-100">{entry.memo || '—'}</span>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">Source: </span>
          <span className="text-slate-900 dark:text-slate-100">{entry.source_module}</span>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">Created: </span>
          <span className="text-slate-900 dark:text-slate-100">{formatDate(entry.created_at)}</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Account</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Debit</th>
              <th className="px-3 py-2 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l) => (
              <tr key={l.id ?? l.line_no} className="border-b border-slate-100 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.line_no}</td>
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{l.account_code}</span>{' '}
                  <span className="text-slate-900 dark:text-slate-100">{l.account_name}</span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{l.description ?? '—'}</td>
                <td className="px-3 py-2 num">{Number(l.debit) > 0 ? formatPHP(Number(l.debit)) : ''}</td>
                <td className="px-3 py-2 num">{Number(l.credit) > 0 ? formatPHP(Number(l.credit)) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 dark:bg-slate-800 text-sm font-medium">
            <tr className="border-t border-slate-200 dark:border-slate-700">
              <td colSpan={3} className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-400">Totals</td>
              <td className="px-3 py-2 num">{formatPHP(totalDebit)}</td>
              <td className="px-3 py-2 num">{formatPHP(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {entry.status === 'voided' && entry.void_reason && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <strong>Voided:</strong> {entry.void_reason}
        </div>
      )}
    </div>
  );
}
