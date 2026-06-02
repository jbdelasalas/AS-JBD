'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import DataTable, { ColDef } from '@/components/DataTable';

interface Row {
  id: string; doc_no: string; transaction_date: string; status: string;
  source_heads: number; source_kgs: number; total_output_kgs: number;
  yield_pct: number | null; source_item_name: string; source_sku: string;
}

const S: Record<string, string> = {
  saved: 'bg-slate-100 text-slate-600', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-red-100 text-red-700',
};

const COLUMNS: ColDef<Row>[] = [
  { key: 'doc_no',            header: 'Doc No.',       render: r => <Link href={`/dashboard/poultry/conversions/${r.id}`} className="font-mono text-brand-600 hover:underline dark:text-brand-400">{r.doc_no}</Link>, exportValue: r => r.doc_no },
  { key: 'source_item_name',  header: 'Source Item',   render: r => <span className="text-slate-700 dark:text-slate-300">{r.source_sku} — {r.source_item_name}</span>, exportValue: r => `${r.source_sku} ${r.source_item_name}` },
  { key: 'transaction_date',  header: 'Date',          render: r => <span className="text-slate-500">{formatDate(r.transaction_date)}</span>, exportValue: r => formatDate(r.transaction_date) },
  { key: 'source_heads',      header: 'Source Heads',  align: 'right', render: r => <span className="font-mono">{Number(r.source_heads).toLocaleString()}</span>, exportValue: r => String(r.source_heads) },
  { key: 'source_kgs',        header: 'Source KGS',    align: 'right', render: r => <span className="font-mono">{Number(r.source_kgs).toFixed(2)}</span>, exportValue: r => String(r.source_kgs) },
  { key: 'total_output_kgs',  header: 'Output KGS',    align: 'right', render: r => <span className="font-mono">{Number(r.total_output_kgs).toFixed(2)}</span>, exportValue: r => String(r.total_output_kgs) },
  { key: 'yield_pct',         header: 'Yield %',       align: 'right', render: r => <span className="font-mono">{r.yield_pct != null ? `${r.yield_pct}%` : '—'}</span>, exportValue: r => r.yield_pct != null ? String(r.yield_pct) : '' },
  { key: 'status',            header: 'Status',        render: r => <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${S[r.status] ?? ''}`}>{r.status}</span>, exportValue: r => r.status },
];

export default function ConversionsPage() {
  const [rows, setRows]     = useState<Row[]>([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage]     = useState(1);
  const PAGE = 15;

  useEffect(() => {
    const cid = localStorage.getItem('company_id'); if (!cid) return;
    setLoading(true);
    api.get<{ data: Row[]; total: number }>(`/poultry/conversions?company_id=${cid}&limit=${PAGE}&offset=${(page-1)*PAGE}${status ? `&status=${status}` : ''}`)
      .then(r => { setRows(r.data); setTotal(r.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [status, page]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Conversions</h1><p className="text-sm text-slate-500">Process live chicken into dressed / cut parts.</p></div>
        <Link href="/dashboard/poultry/conversions/new" className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New Conversion</Link>
      </div>
      <div className="mb-3 flex gap-2 text-xs">
        {['','saved','posted','voided'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`rounded px-3 py-1 ${status===s?'bg-brand-600 text-white':'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{s||'All'}</button>
        ))}
      </div>
      <DataTable id="conversion-list" columns={COLUMNS} rows={rows} loading={loading} filename="conversions" emptyMessage="No conversions found.">
        <Pagination page={page} total={total} pageSize={PAGE} onChange={p => setPage(p)} />
      </DataTable>
    </div>
  );
}
