'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface Row {
  id: string; doc_no: string; tally_type: string; transfer_date: string; status: string;
  harvested_heads: number; net_heads: number; net_kgs: number;
  grow_cycle_no: string | null; plate_number: string | null; driver: string | null;
}

const S: Record<string, string> = {
  saved: 'bg-slate-100 text-slate-600', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700',
};

const COLUMNS: ColDef<Row>[] = [
  { key: 'doc_no',        header: 'Doc No.',      render: r => <Link href={`/dashboard/poultry/tally-sheets/${r.id}`} className="font-mono text-brand-600 hover:underline dark:text-brand-400">{r.doc_no}</Link>, exportValue: r => r.doc_no },
  { key: 'tally_type',    header: 'Type',         render: r => <span className="text-slate-500 capitalize">{r.tally_type}</span>, exportValue: r => r.tally_type },
  { key: 'grow_cycle_no', header: 'Grow Cycle',   render: r => <span className="font-mono text-slate-500 text-xs">{r.grow_cycle_no ?? '—'}</span>, exportValue: r => r.grow_cycle_no ?? '' },
  { key: 'transfer_date', header: 'Date',         render: r => <span className="text-slate-500">{formatDate(r.transfer_date)}</span>, exportValue: r => formatDate(r.transfer_date) },
  { key: 'net_heads',     header: 'Heads',        align: 'right', render: r => <span className="font-mono">{Number(r.net_heads).toLocaleString()}</span>, exportValue: r => String(r.net_heads) },
  { key: 'net_kgs',       header: 'Net KGS',      align: 'right', render: r => <span className="font-mono">{Number(r.net_kgs).toLocaleString()}</span>, exportValue: r => String(r.net_kgs) },
  { key: 'driver',        header: 'Driver',       render: r => <span className="text-slate-500">{r.driver ?? '—'}</span>, exportValue: r => r.driver ?? '' },
  { key: 'status',        header: 'Status',       render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${S[r.status] ?? ''}`}>{r.status}</span>, exportValue: r => r.status },
];

export default function TallySheetsPage() {
  const [rows, setRows]     = useState<Row[]>([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage]     = useState(1);
  const PAGE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true);
    api.get<{ data: Row[]; total: number }>(`/poultry/tally-sheets?company_id=${cid}&limit=${PAGE}&offset=${(page-1)*PAGE}${status ? `&status=${status}` : ''}`)
      .then(r => { setRows(r.data); setTotal(r.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [status, page]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Inventory Tally Sheet</h1><p className="text-sm text-slate-500">Harvest and transfer tallies.</p></div>
        <Link href="/dashboard/poultry/tally-sheets/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New Tally Sheet</Link>
      </div>
      <div className="mb-3 flex gap-2 text-xs">
        {['','saved','posted','voided'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`rounded px-3 py-1 ${status===s?'bg-brand-600 text-white':'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{s||'All'}</button>
        ))}
      </div>
      <DataTable id="tally-list" columns={COLUMNS} rows={rows} loading={loading} filename="tally-sheets" emptyMessage="No tally sheets found.">
        <Pagination page={page} total={total} pageSize={PAGE} onChange={p => { setPage(p); }} />
      </DataTable>
    </div>
  );
}
