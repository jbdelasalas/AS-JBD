'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface AuditEntry {
  id: string; user_email: string | null; action: string;
  table_name: string; record_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null; created_at: string;
}

const ACTION_STYLES: Record<string, string> = {
  INSERT: 'bg-emerald-100 text-emerald-700',
  UPDATE: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-red-100 text-red-700',
};

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableName, setTableName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  function load() {
    const companyId = localStorage.getItem('company_id') ?? '';
    const q = new URLSearchParams({ company_id: companyId, limit: '100' });
    if (tableName) q.set('table_name', tableName);
    setLoading(true);
    api.get<AuditEntry[]>(`/admin/audit-log?${q}`)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Audit Log</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Last 100 entries. Filter by table to narrow.</p>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <input value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="Filter by table name…"
          className="w-56 rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100" />
        <button onClick={load}
          className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
          Apply
        </button>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Time</th>
              <th className="px-3 py-2 text-left font-medium">User</th>
              <th className="px-3 py-2 text-left font-medium">Action</th>
              <th className="px-3 py-2 text-left font-medium">Table</th>
              <th className="px-3 py-2 text-left font-medium">Record</th>
              <th className="px-3 py-2 text-left font-medium">IP</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">No audit entries found.</td></tr>
            ) : rows.map((r) => (
              <>
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatDate(r.created_at)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{r.user_email ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${ACTION_STYLES[r.action] ?? 'bg-slate-100 text-slate-600 dark:text-slate-400'}`}>
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{r.table_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400 max-w-[120px] truncate">{r.record_id ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.ip_address ?? '—'}</td>
                  <td className="px-3 py-2">
                    {(r.old_values || r.new_values) && (
                      <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                        className="text-[11px] text-brand-600 dark:text-brand-400 hover:underline">
                        {expanded === r.id ? 'Hide' : 'Diff'}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr key={`${r.id}-diff`} className="bg-slate-50 dark:bg-slate-800">
                    <td colSpan={7} className="px-4 py-3">
                      <div className="grid grid-cols-2 gap-4">
                        {r.old_values && (
                          <div>
                            <div className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">Before</div>
                            <pre className="overflow-auto rounded bg-red-50 p-2 text-[11px] text-red-800 max-h-40">
                              {JSON.stringify(r.old_values, null, 2)}
                            </pre>
                          </div>
                        )}
                        {r.new_values && (
                          <div>
                            <div className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">After</div>
                            <pre className="overflow-auto rounded bg-emerald-50 p-2 text-[11px] text-emerald-800 max-h-40">
                              {JSON.stringify(r.new_values, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
