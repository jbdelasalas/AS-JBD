"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Pagination } from '@/components/Pagination';
import type { WhtCertificate } from '@perpet/shared';

const PAGE_SIZE = 15;

export default function BirCertificatesPage() {
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<WhtCertificate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [filterQuarter, setFilterQuarter] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    bill_id: '', supplier_id: '', bir_atc_code: 'WC010',
    taxable_amount: '', rate_pct: '1',
    period_year: new Date().getFullYear(), period_quarter: String(Math.ceil((new Date().getMonth() + 1) / 3)),
  });

  useEffect(() => {
    const stored = localStorage.getItem('selected_company_id');
    if (stored) setCompanyId(stored);
  }, []);

  useEffect(() => { if (companyId) load(); }, [companyId, page, filterYear, filterQuarter, filterStatus]);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        company_id: companyId,
        ...(filterYear && { year: filterYear }),
        ...(filterQuarter && { quarter: filterQuarter }),
        ...(filterStatus && { status: filterStatus }),
      });
      const res = await api.get(`/api/v1/bir/certificates?${qs}`) as WhtCertificate[];
      const all = Array.isArray(res) ? res : [];
      setTotal(all.length);
      setRows(all);
    } catch { setRows([]); } finally { setLoading(false); }
  }

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function save() {
    setSaving(true); setError('');
    try {
      await api.post('/api/v1/bir/certificates', { ...form, company_id: companyId });
      setShowNew(false);
      load();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  const amountWithheld = (form.taxable_amount && form.rate_pct)
    ? (Number(form.taxable_amount) * Number(form.rate_pct) / 100).toFixed(2)
    : '0.00';

  const statusColor = (s: string) => ({
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
    issued: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    filed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  }[s] ?? 'bg-slate-100 text-slate-600');

  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">BIR Form 2307</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Certificate of creditable tax withheld at source (EWT)</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + New Certificate
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select value={filterYear} onChange={(e) => { setFilterYear(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterQuarter} onChange={(e) => { setFilterQuarter(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
          <option value="">All Quarters</option>
          {[1,2,3,4].map((q) => <option key={q} value={String(q)}>Q{q}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="issued">Issued</option>
          <option value="filed">Filed</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              {['Cert No.','Supplier','ATC Code','Taxable Amount','Rate','Withheld','Period','Status'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No certificates found.</td></tr>}
            {paged.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/dashboard/bir/certificates/${c.id}`} className="text-brand-700 hover:underline dark:text-brand-400">
                    {c.cert_no}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{c.supplier_name ?? c.supplier_id}</td>
                <td className="px-3 py-2 font-mono text-xs text-blue-700 dark:text-blue-300">{c.bir_atc_code}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">{c.taxable_amount.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{c.rate_pct}%</td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-red-700 dark:text-red-400">{c.amount_withheld.toFixed(2)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">Q{c.period_quarter} {c.period_year}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(c.status)}`}>{c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      {/* New certificate modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-slate-900 shadow-xl p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">New Form 2307</h2>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Bill ID *</label>
                <input type="text" value={form.bill_id} onChange={(e) => setForm((f) => ({ ...f, bill_id: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                  placeholder="UUID of the AP bill" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Supplier ID *</label>
                <input type="text" value={form.supplier_id} onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                  placeholder="UUID of the supplier" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">BIR ATC Code *</label>
                  <input type="text" value={form.bir_atc_code} onChange={(e) => setForm((f) => ({ ...f, bir_atc_code: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                    placeholder="e.g. WC010" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">EWT Rate (%)</label>
                  <input type="number" value={form.rate_pct} onChange={(e) => setForm((f) => ({ ...f, rate_pct: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Taxable Amount (₱)</label>
                <input type="number" value={form.taxable_amount} onChange={(e) => setForm((f) => ({ ...f, taxable_amount: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
              </div>
              <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
                <span className="text-slate-600 dark:text-slate-400">Amount to Withhold: </span>
                <span className="font-mono font-semibold text-red-700 dark:text-red-400">₱ {amountWithheld}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Period Year</label>
                  <input type="number" value={form.period_year} onChange={(e) => setForm((f) => ({ ...f, period_year: parseInt(e.target.value) }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Quarter</label>
                  <select value={form.period_quarter} onChange={(e) => setForm((f) => ({ ...f, period_quarter: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
                    {[1,2,3,4].map((q) => <option key={q} value={String(q)}>Q{q}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setShowNew(false); setError(''); }}
                className="rounded px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300">Cancel</button>
              <button onClick={save} disabled={saving}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Create Certificate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
