'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';
import type { TrialBalanceRow } from '@perpet/shared';

interface TrialBalanceResponse {
  as_of: string;
  rows: TrialBalanceRow[];
  total_debit: number;
  total_credit: number;
  is_balanced: boolean;
}

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

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Trial balance</h1>
      <p className="mb-4 text-sm text-slate-600">All posted entries up to and including the as-of date.</p>

      <div className="mb-4 flex items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">As of date</label>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
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
            <span className="text-slate-600">{data.rows.length} accounts with movement</span>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Code</th>
                  <th className="px-3 py-2 text-left font-medium">Account</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Debit</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-slate-500">No posted entries yet.</td></tr>
                ) : (
                  data.rows.map((r) => {
                    // Show net balance on the normal side
                    const isDr = ['ASSET', 'EXPENSE'].includes(r.account_type);
                    const net = r.debit - r.credit;
                    const dr = isDr ? Math.max(net, 0)  : Math.max(-net, 0);
                    const cr = isDr ? Math.max(-net, 0) : Math.max(net, 0);
                    return (
                      <tr key={r.account_code} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{r.account_code}</td>
                        <td className="px-3 py-2 text-slate-900">{r.account_name}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{r.account_type}</td>
                        <td className="px-3 py-2 num">{dr > 0 ? formatPHP(dr) : ''}</td>
                        <td className="px-3 py-2 num">{cr > 0 ? formatPHP(cr) : ''}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="bg-slate-50 text-sm font-medium">
                <tr className="border-t border-slate-200">
                  <td colSpan={3} className="px-3 py-2 text-right text-xs text-slate-600">Totals</td>
                  <td className="px-3 py-2 num">{formatPHP(data.total_debit)}</td>
                  <td className="px-3 py-2 num">{formatPHP(data.total_credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
