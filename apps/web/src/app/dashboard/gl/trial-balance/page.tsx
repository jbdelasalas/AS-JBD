'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';
import type { TrialBalanceRow } from '@perpet/shared';
import DataTable, { ColDef } from '@/components/DataTable';

interface TrialBalanceResponse {
  as_of: string;
  rows: TrialBalanceRow[];
  total_debit: number;
  total_credit: number;
  is_balanced: boolean;
}

interface DisplayRow extends TrialBalanceRow {
  net_debit: number;
  net_credit: number;
}

const COLUMNS: ColDef<DisplayRow>[] = [
  { key: 'account_code', header: 'Code',    render: r => <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{r.account_code}</span>, exportValue: r => r.account_code },
  { key: 'account_name', header: 'Account', render: r => <span className="text-slate-900 dark:text-slate-100">{r.account_name}</span>, exportValue: r => r.account_name },
  { key: 'account_type', header: 'Type',    render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.account_type}</span>, exportValue: r => r.account_type },
  { key: 'net_debit',    header: 'Debit',   align: 'right', render: r => <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{r.net_debit > 0 ? formatPHP(r.net_debit) : ''}</span>, exportValue: r => r.net_debit > 0 ? String(r.net_debit) : '' },
  { key: 'net_credit',   header: 'Credit',  align: 'right', render: r => <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{r.net_credit > 0 ? formatPHP(r.net_credit) : ''}</span>, exportValue: r => r.net_credit > 0 ? String(r.net_credit) : '' },
];

export default function TrialBalancePage() {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<TrialBalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<TrialBalanceResponse>(
        `/gl/reports/trial-balance?company_id=${companyId}&as_of=${asOf}`,
      );
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  const displayRows: DisplayRow[] = (data?.rows ?? []).map((r) => {
    const isDr = ['ASSET', 'EXPENSE'].includes(r.account_type);
    const net = r.debit - r.credit;
    return { ...r, net_debit: isDr ? Math.max(net, 0) : Math.max(-net, 0), net_credit: isDr ? Math.max(-net, 0) : Math.max(net, 0) };
  });

  const totalsRow = data ? (
    <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-medium">
      <td colSpan={3} className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-400">Totals</td>
      <td className="px-3 py-2 text-right font-mono text-xs text-slate-900 dark:text-slate-100">{formatPHP(data.total_debit)}</td>
      <td className="px-3 py-2 text-right font-mono text-xs text-slate-900 dark:text-slate-100">{formatPHP(data.total_credit)}</td>
    </tr>
  ) : undefined;

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Trial balance</h1>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">All posted entries up to and including the as-of date.</p>

      <div className="mb-4 flex items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">As of date</label>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {data && (
        <>
          <div className="mb-3 flex items-center gap-3 text-xs">
            <span className={`rounded px-2 py-0.5 font-medium ${data.is_balanced ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
              {data.is_balanced ? '✓ Balanced' : '✗ Out of balance'}
            </span>
            <span className="text-slate-600 dark:text-slate-400">{data.rows.length} accounts with movement</span>
          </div>

          <DataTable
            id="gl-trial-balance"
            columns={COLUMNS}
            rows={displayRows}
            loading={loading}
            filename="trial-balance"
            emptyMessage="No posted entries yet."
            footer={totalsRow}
          />
        </>
      )}
    </div>
  );
}
