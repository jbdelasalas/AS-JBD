'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { formatPHP } from '@/lib/format';
import type { Account, JournalEntry } from '@perpet/shared';

interface LineRow {
  account_id: string;
  description: string;
  debit: string;       // strings while editing, parsed on submit
  credit: string;
}

const EMPTY_LINE: LineRow = { account_id: '', description: '', debit: '', credit: '' };

export default function NewJournalEntryPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<LineRow[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    api
      .get<Account[]>(`/gl/accounts?company_id=${companyId}&active_only=true`)
      .then(setAccounts)
      .catch((e) => setError(e.message));
  }, []);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const credit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    return { debit, credit, diff: debit - credit, balanced: Math.abs(debit - credit) < 0.0001 && debit > 0 };
  }, [lines]);

  function updateLine(idx: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));
  }

  async function submit(action: 'save' | 'save_and_post') {
    setError(null);
    const companyId = localStorage.getItem('company_id');
    if (!companyId) {
      setError('No company selected');
      return;
    }

    const payloadLines = lines
      .filter((l) => l.account_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
      .map((l) => ({
        account_id: l.account_id,
        description: l.description || undefined,
        debit:  parseFloat(l.debit)  || 0,
        credit: parseFloat(l.credit) || 0,
      }));

    if (payloadLines.length < 2) {
      setError('At least two lines are required, each with an account and an amount');
      return;
    }
    if (!totals.balanced) {
      setError(`Entry is unbalanced. Debit ${formatPHP(totals.debit)} vs credit ${formatPHP(totals.credit)}`);
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.post<JournalEntry>('/gl/journal-entries', {
        company_id: companyId,
        entry_date: entryDate,
        reference: reference || undefined,
        memo: memo || undefined,
        lines: payloadLines,
      });

      if (action === 'save_and_post') {
        await api.post(`/gl/journal-entries/${created.id}/post`);
      }

      router.push(`/dashboard/gl/journal-entries/${created.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New journal entry</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Each line must have either a debit or a credit. Total debits must equal total credits to post.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Entry date</label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Reference</label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. Bill #12345"
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Memo</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Description of the entry"
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      </div>

      <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium" style={{ width: 60 }}>#</th>
              <th className="px-3 py-2 text-left font-medium">Account</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium" style={{ width: 140 }}>Debit</th>
              <th className="px-3 py-2 text-right font-medium" style={{ width: 140 }}>Credit</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="border-b border-slate-100 dark:border-slate-700 last:border-0">
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{idx + 1}</td>
                <td className="px-3 py-1">
                  <select
                    value={line.account_id}
                    onChange={(e) => updateLine(idx, { account_id: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">— Select account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1">
                  <input
                    type="text"
                    value={line.description}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </td>
                <td className="px-3 py-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.debit}
                    onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? '' : line.credit })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-right text-sm num"
                  />
                </td>
                <td className="px-3 py-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.credit}
                    onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? '' : line.debit })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-right text-sm num"
                  />
                </td>
                <td className="px-1">
                  {lines.length > 2 && (
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-slate-400 hover:text-red-600"
                      title="Remove line"
                    >×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 dark:bg-slate-800 text-sm font-medium">
            <tr className="border-t border-slate-200 dark:border-slate-700">
              <td colSpan={3} className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-400">Totals</td>
              <td className="px-3 py-2 num">{formatPHP(totals.debit)}</td>
              <td className="px-3 py-2 num">{formatPHP(totals.credit)}</td>
              <td />
            </tr>
            <tr className="border-t border-slate-100 dark:border-slate-700">
              <td colSpan={3} className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-400">Difference</td>
              <td colSpan={2} className={`px-3 py-2 num ${totals.balanced ? 'text-emerald-700' : 'text-red-700'}`}>
                {totals.balanced ? '✓ balanced' : formatPHP(totals.diff)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2">
          <button
            onClick={addLine}
            className="text-xs text-brand-700 hover:underline"
          >+ Add line</button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => router.back()}
          disabled={submitting}
          className="rounded border border-slate-300 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:bg-slate-800 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={() => submit('save')}
          disabled={submitting}
          className="rounded border border-brand-600 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          Save as draft
        </button>
        <button
          onClick={() => submit('save_and_post')}
          disabled={submitting || !totals.balanced}
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Save and post
        </button>
      </div>
    </div>
  );
}
