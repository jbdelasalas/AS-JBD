'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface JobOrder { id: string; batch_no: string; client_name: string; status: string; }
interface Invoice {
  id: string; invoice_no: string | null; service: string;
  quantity: string; rate: string; amount: string; status: string;
  batch_no: string; client_name: string; entry_no: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  issued: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  cleared: 'bg-emerald-100 text-emerald-700',
  credit_approved: 'bg-blue-100 text-blue-700',
  void: 'bg-red-100 text-red-700',
};

export default function InvoicesPage() {
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [jobOrderId, setJobOrderId] = useState('');
  const [saving, setSaving] = useState(false);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    api.get<{ data: Invoice[] }>(`/dressing-plant/invoices?company_id=${companyId}`)
      .then((r) => setRows(r.data)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    api.get<{ data: JobOrder[] }>(`/dressing-plant/job-orders?company_id=${companyId}`)
      .then((r) => { setOrders(r.data); if (r.data[0]) setJobOrderId(r.data[0].id); }).catch(() => {});
    load();
  }, [companyId, load]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!jobOrderId) return;
    setSaving(true);
    try {
      await api.post('/dressing-plant/invoices', { job_order_id: jobOrderId });
      load();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Invoices</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Basic-tolling billing runs through the posting engine — idempotent Dr 1130 AR / Cr 4100 Tolling Revenue at the rate live on the batch date.</p>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={generate} className="mb-5 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex-1 min-w-[220px]">
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Batch to invoice *</label>
          <select value={jobOrderId} onChange={(e) => setJobOrderId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {orders.length === 0 && <option value="">No batches yet</option>}
            {orders.map((o) => <option key={o.id} value={o.id}>{o.batch_no} — {o.client_name} ({o.status})</option>)}
          </select>
        </div>
        <button type="submit" disabled={saving || !jobOrderId}
          className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? '…' : 'Generate tolling invoice'}
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Batch</th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Service</th>
              <th className="px-3 py-2 text-right">Qty × Rate</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">GL entry</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">No invoices yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{r.batch_no}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{r.client_name}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{r.service.replace(/_/g, ' ')}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-500 dark:text-slate-400">{Number(r.quantity).toLocaleString()} × {Number(r.rate).toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-xs font-medium text-slate-900 dark:text-slate-100">₱{Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">{r.entry_no ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status] ?? 'bg-slate-200 text-slate-600'}`}>{r.status.replace(/_/g, ' ')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
