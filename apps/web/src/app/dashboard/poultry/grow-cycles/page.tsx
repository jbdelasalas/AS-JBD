'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface Row {
  id: string; doc_no: string; start_date: string; expected_end_date: string | null; status: string;
  heads_in: number; heads_available: number; total_mortality: number; heads_harvested: number;
  item_name: string; building_name: string | null; batch_no: string;
}

const S: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700', harvesting: 'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700', closed: 'bg-slate-100 text-slate-600',
};

const COLUMNS: ColDef<Row>[] = [
  { key: 'doc_no',          header: 'Doc No.',     render: r => <Link href={`/dashboard/poultry/grow-cycles/${r.id}`} className="font-mono text-brand-600 hover:underline dark:text-brand-400">{r.doc_no}</Link>, exportValue: r => r.doc_no },
  { key: 'batch_no',        header: 'Batch',       render: r => <span className="font-mono text-slate-500 text-xs">{r.batch_no}</span>, exportValue: r => r.batch_no },
  { key: 'item_name',       header: 'Item',        render: r => <span className="text-slate-700 dark:text-slate-300">{r.item_name}</span>, exportValue: r => r.item_name },
  { key: 'building_name',   header: 'Building',    render: r => <span className="text-slate-500">{r.building_name ?? '—'}</span>, exportValue: r => r.building_name ?? '' },
  { key: 'start_date',      header: 'Start',       render: r => <span className="text-slate-500">{formatDate(r.start_date)}</span>, exportValue: r => formatDate(r.start_date) },
  { key: 'heads_in',        header: 'Heads In',    align: 'right', render: r => <span className="font-mono">{Number(r.heads_in).toLocaleString()}</span>, exportValue: r => String(r.heads_in) },
  { key: 'heads_available', header: 'Available',   align: 'right', render: r => <span className="font-mono font-medium text-emerald-600">{Number(r.heads_available).toLocaleString()}</span>, exportValue: r => String(r.heads_available) },
  { key: 'total_mortality', header: 'Mortality',   align: 'right', render: r => <span className="font-mono text-red-500">{Number(r.total_mortality).toLocaleString()}</span>, exportValue: r => String(r.total_mortality) },
  { key: 'status',          header: 'Status',      render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${S[r.status] ?? 'bg-slate-100 text-slate-600'}`}>{r.status}</span>, exportValue: r => r.status },
];

export default function GrowCyclesPage() {
  const [rows, setRows]     = useState<Row[]>([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage]     = useState(1);
  const PAGE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true);
    api.get<{ data: Row[]; total: number }>(`/poultry/grow-cycles?company_id=${cid}&limit=${PAGE}&offset=${(page-1)*PAGE}${status ? `&status=${status}` : ''}`)
      .then(r => { setRows(r.data); setTotal(r.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [status, page]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Grow Cycles</h1><p className="text-sm text-slate-500">Track growing batches from start to harvest.</p></div>
        <Link href="/dashboard/poultry/grow-cycles/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New Grow Cycle</Link>
      </div>
      <div className="mb-3 flex gap-2 text-xs">
        {['','active','harvesting','completed','closed'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`rounded px-3 py-1 ${status===s?'bg-brand-600 text-white':'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{s||'All'}</button>
        ))}
      </div>
      <DataTable id="grow-cycle-list" columns={COLUMNS} rows={rows} loading={loading} filename="grow-cycles" emptyMessage="No grow cycles found.">
        <Pagination page={page} total={total} pageSize={PAGE} onChange={p => setPage(p)} />
      </DataTable>
    </div>
  );
}
