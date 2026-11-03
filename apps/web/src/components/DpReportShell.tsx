'use client';

// Shared bits for the printable dressing-plant reports: batch picker (from the
// ?batch= query), batch-info loader and print styles that drop the app chrome.

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

export interface ReportTruck {
  seq: number; plate_no: string | null; seal_no: string | null; farm_name: string | null; farm_address: string | null;
  house_no: string | null; farm_count: number | null; farm_weight_kg: string | null; net_live_weight_kg: string;
  coop_count: number | null; head_count: number; doa_count: number | null; doa_weight_kg: string | null;
  farm_departure: string | null; plant_arrival: string | null; start_hang: string | null; end_hang: string | null;
}
export interface ReportLine { item_name: string; category: string; packs: number; heads: number; weight_kg: string; }
export interface ReportJob {
  id: string; batch_no: string; client_name: string; farm_location: string | null; harvest_date: string | null;
  production_date: string | null; received_at: string | null; plant_checker: string | null;
  report_extras: Record<string, string>;
}
export interface BatchReport { job: ReportJob; trucks: ReportTruck[]; lines: ReportLine[]; }

export const PRINT_CSS = `
@media print {
  aside, header, .no-print { display: none !important; }
  html, body, main, .h-screen { height: auto !important; overflow: visible !important; background: #fff !important; }
  main { padding: 0 !important; }
  @page { size: landscape; margin: 8mm; }
}`;

export function useBatchReport() {
  const [batches, setBatches] = useState<{ id: string; batch_no: string; client_name: string; trucks: number }[]>([]);
  const [batchId, setBatchId] = useState('');
  const [report, setReport] = useState<BatchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: { id: string; batch_no: string; client_name: string; trucks: number }[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => {
        const received = r.data.filter((b) => Number(b.trucks) > 0);
        setBatches(received);
        const q = new URLSearchParams(window.location.search).get('batch');
        setBatchId(q && received.some((b) => b.id === q) ? q : (received[0]?.id ?? ''));
      }).catch((e) => setError(e.message));
  }, [companyId]);

  const reload = useCallback(() => {
    if (!batchId) { setReport(null); return; }
    api.get<BatchReport>(`/dressing-plant/batch-info?job_order_id=${batchId}`).then(setReport).catch((e) => setError(e.message));
  }, [batchId]);
  useEffect(() => { reload(); }, [reload]);

  return { batches, batchId, setBatchId, report, error, setError, reload };
}

export function ReportToolbar({ title, batches, batchId, setBatchId }: {
  title: string; batches: { id: string; batch_no: string; client_name: string }[]; batchId: string; setBatchId: (id: string) => void;
}) {
  return (
    <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}
          className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          {batches.length === 0 && <option value="">No received batches</option>}
          {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_no} — {b.client_name}</option>)}
        </select>
      </div>
      <button onClick={() => window.print()} disabled={!batchId}
        className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Print</button>
    </div>
  );
}

/** Minutes between two HH:MM times, wrapping past midnight. */
export function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
  return (m(to) - m(from) + 1440) % 1440;
}
export const hhmmOf = (mins: number | null) => (mins == null ? '' : `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
export const fmt = (v: number | null | undefined, dp = 2) =>
  v == null || Number.isNaN(v) ? '' : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const int = (v: number | null | undefined) => (v == null ? '' : v.toLocaleString());
/** 12-hour time like the sheet: 6:42 PM. */
export const ampm = (t: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
