'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface ERRow {
  id: string;
  er_no: string;
  report_date: string;
  period_from: string | null;
  period_to: string | null;
  employee_name: string;
  employee_no: string;
  purpose: string | null;
  total: number;
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft:            'bg-slate-100 text-slate-700 dark:text-slate-300',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved:         'bg-emerald-100 text-emerald-700',
  cancelled:        'bg-red-100 text-red-700',
};

const STATUSES = ['all', 'draft', 'pending_approval', 'approved', 'cancelled'] as const;

const COLUMNS: ColDef<ERRow>[] = [
  {
    key: 'er_no',
    header: 'ER No.',
    render: r => (
      <Link href={`/dashboard/ap/expense-reports/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">
        {r.er_no}
      </Link>
    ),
    exportValue: r => r.er_no,
  },
  {
    key: 'report_date',
    header: 'Date',
    render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.report_date)}</span>,
    exportValue: r => formatDate(r.report_date),
  },
  {
    key: 'employee_name',
    header: 'Employee',
    render: r => (
      <div>
        <div className="font-medium text-slate-900 dark:text-slate-100">{r.employee_name}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{r.employee_no}</div>
      </div>
    ),
    exportValue: r => r.employee_name,
  },
  {
    key: 'purpose',
    header: 'Purpose',
    render: r => <span className="text-xs text-slate-600 dark:text-slate-400">{r.purpose ?? '—'}</span>,
    exportValue: r => r.purpose ?? '',
  },
  {
    key: 'period_from',
    header: 'Period',
    render: r => (
      r.period_from
        ? <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(r.period_from)} – {r.period_to ? formatDate(r.period_to) : '…'}</span>
        : <span className="text-slate-400 text-xs">—</span>
    ),
    exportValue: r => r.period_from ? `${formatDate(r.period_from)} - ${r.period_to ? formatDate(r.period_to) : ''}` : '',
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    render: r => <span className="font-mono text-xs">{formatPHP(r.total)}</span>,
    exportValue: r => String(r.total),
  },
  {
    key: 'status',
    header: 'Status',
    render: r => (
      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>
        {r.status.replace(/_/g, ' ')}
      </span>
    ),
    exportValue: r => r.status,
  },
];

export default function ExpenseReportsPage() {
  const [rows, setRows]     = useState<ERRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [status, setStatus] = useState<string>('all');
  const [page, setPage]     = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    setLoading(true);
    setPage(1);
    const q = status === 'all'
      ? `/ap/expense-reports?company_id=${cid}&limit=500`
      : `/ap/expense-reports?company_id=${cid}&status=${status}&limit=500`;
    api.get<{ data: ERRow[] }>(q)
      .then(r => setRows(r.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Expense Reports</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Employee expense reimbursement requests.</p>
        </div>
        <Link href="/dashboard/ap/expense-reports/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          + New expense report
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              status === s
                ? 'bg-brand-600 text-white'
                : 'border border-slate-300 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
            }`}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <DataTable id="ap-expense-reports" columns={COLUMNS} rows={paged} exportRows={rows} loading={loading} filename="ap-expense-reports">
        <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataTable>
    </div>
  );
}
