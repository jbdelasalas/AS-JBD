'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';

interface WorksheetLine {
  line_id: string; entry_id: string; entry_no: string; entry_date: string;
  description: string | null; source_doc_type: string | null;
  debit: number; credit: number; cleared: boolean;
}
interface Summary {
  beginning_balance: number; cleared_debits: number; cleared_credits: number;
  cleared_balance: number; statement_ending_balance: number;
  outstanding_deposits: number; outstanding_withdrawals: number; difference: number;
}
interface Worksheet {
  id: string; account_name: string; bank_name: string | null;
  gl_code: string | null; gl_name: string | null;
  statement_date: string; statement_ending_balance: number; beginning_balance: number;
  status: string; summary: Summary; lines: WorksheetLine[];
}
interface GlAccount { id: string; code: string; name: string; account_type: string; }

const RECONCILED = (d: number) => Math.abs(d) < 0.005;

export default function ReconciliationWorksheetPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);

  const [data, setData] = useState<Worksheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Adjustment modal
  const [showAdj, setShowAdj] = useState(false);
  const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
  const [adj, setAdj] = useState({ direction: 'credit', amount: '', offset_account_id: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData(await api.get<Worksheet>(`/gl/bank-reconciliations/${id}`));
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed to load'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const locked = data?.status === 'completed';

  async function toggle(line: WorksheetLine) {
    if (locked || busy) return;
    setBusy(true); setError('');
    try {
      await api.patch(`/gl/bank-reconciliations/${id}/items`, { line_id: line.line_id, cleared: !line.cleared });
      await load();
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed to update'); }
    finally { setBusy(false); }
  }

  async function complete(force = false) {
    setBusy(true); setError('');
    try {
      await api.post(`/gl/bank-reconciliations/${id}/complete`, { force });
      await load();
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed to complete'); }
    finally { setBusy(false); }
  }

  async function openAdjustment() {
    setAdj({ direction: 'credit', amount: '', offset_account_id: '', description: '' });
    setShowAdj(true);
    if (glAccounts.length === 0) {
      const cid = localStorage.getItem('company_id') ?? '';
      try {
        const res = await api.get<GlAccount[]>(`/gl/accounts?company_id=${cid}&limit=500`);
        setGlAccounts(res);
      } catch { /* leave empty */ }
    }
  }

  async function saveAdjustment() {
    setBusy(true); setError('');
    try {
      await api.post(`/gl/bank-reconciliations/${id}/adjustment`, {
        direction: adj.direction,
        amount: Number(adj.amount || 0),
        offset_account_id: adj.offset_account_id,
        description: adj.description || undefined,
      });
      setShowAdj(false);
      await load();
    } catch (e: unknown) { setError((e as Error).message ?? 'Failed to record adjustment'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="px-3 py-8 text-center text-slate-400">Loading…</div>;
  if (!data) return <div className="px-3 py-8 text-center text-red-600">{error || 'Not found'}</div>;

  const s = data.summary;
  const reconciled = RECONCILED(s.difference);

  return (
    <div>
      <button onClick={() => router.push('/dashboard/gl/bank-reconciliation')}
        className="mb-3 text-xs text-blue-600 hover:underline">← All Reconciliations</button>

      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {data.account_name}{data.bank_name ? <span className="ml-1 text-sm font-normal text-slate-500">· {data.bank_name}</span> : ''}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Statement as of {data.statement_date}
            {data.gl_code ? <span className="ml-2 font-mono text-xs">GL {data.gl_code}</span> : ''}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${locked ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {locked ? 'Completed' : 'In Progress'}
            </span>
          </p>
        </div>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {/* Summary panel */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Beginning Balance" value={s.beginning_balance} />
        <Stat label="Cleared Balance" value={s.cleared_balance} />
        <Stat label="Statement Balance" value={s.statement_ending_balance} />
        <div className={`rounded-lg border p-3 ${reconciled ? 'border-green-200 bg-green-50 dark:bg-green-900/20' : 'border-red-200 bg-red-50 dark:bg-red-900/20'}`}>
          <div className="text-xs text-slate-500 dark:text-slate-400">Difference</div>
          <div className={`mt-1 font-mono text-lg font-semibold ${reconciled ? 'text-green-700' : 'text-red-700'}`}>{formatPHP(s.difference)}</div>
          <div className="text-xs text-slate-500">{reconciled ? 'Reconciled ✓' : 'Not yet reconciled'}</div>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Outstanding deposits {formatPHP(s.outstanding_deposits)} · withdrawals {formatPHP(s.outstanding_withdrawals)}
        </p>
        {!locked && (
          <div className="flex gap-2">
            <button onClick={openAdjustment} disabled={busy}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">
              + Bank Charge / Interest
            </button>
            <button onClick={() => complete(false)} disabled={busy || !reconciled}
              title={reconciled ? '' : 'Difference must be zero to complete'}
              className="rounded bg-green-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
              Complete Reconciliation
            </button>
          </div>
        )}
      </div>

      {/* Worksheet */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-center font-medium">Cleared</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Entry</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Deposit</th>
              <th className="px-3 py-2 text-right font-medium">Withdrawal</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No outstanding transactions on this account.</td></tr>
            )}
            {data.lines.map((l) => (
              <tr key={l.line_id} className={`border-t border-slate-100 dark:border-slate-700 ${l.cleared ? 'bg-green-50/50 dark:bg-green-900/10' : ''}`}>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={l.cleared} disabled={locked || busy} onChange={() => toggle(l)}
                    className="h-4 w-4 cursor-pointer accent-green-600 disabled:cursor-not-allowed" />
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{l.entry_date}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{l.entry_no}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                  {l.description ?? '—'}
                  {l.source_doc_type ? <span className="ml-1 text-xs text-slate-400">({l.source_doc_type})</span> : ''}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-900 dark:text-slate-100">{l.debit > 0 ? formatPHP(l.debit) : ''}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-900 dark:text-slate-100">{l.credit > 0 ? formatPHP(l.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdj && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-slate-900 shadow-xl p-6">
            <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">Record Bank-Only Item</h2>
            <p className="mb-4 text-xs text-slate-500">Bank charges, interest, or other items on the statement but not yet in the books. This posts a balanced journal entry and clears it automatically.</p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Type *</label>
                <select value={adj.direction} onChange={(e) => setAdj((a) => ({ ...a, direction: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
                  <option value="credit">Money out of bank (e.g. bank charge)</option>
                  <option value="debit">Money into bank (e.g. interest earned)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Offset Account *</label>
                <select value={adj.offset_account_id} onChange={(e) => setAdj((a) => ({ ...a, offset_account_id: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
                  <option value="">— select account —</option>
                  {glAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Amount *</label>
                  <input type="number" step="0.01" value={adj.amount} onChange={(e) => setAdj((a) => ({ ...a, amount: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm font-mono" placeholder="0.00" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Description</label>
                  <input value={adj.description} onChange={(e) => setAdj((a) => ({ ...a, description: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm" placeholder="Bank service charge" />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowAdj(false)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={saveAdjustment} disabled={busy || !adj.offset_account_id || !adj.amount}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Post & Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">{formatPHP(value)}</div>
    </div>
  );
}
