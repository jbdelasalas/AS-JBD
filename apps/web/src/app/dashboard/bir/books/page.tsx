"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BookGeneration } from '@perpet/shared';

const BOOK_TYPES = [
  { code: 'SB',  label: 'Sales Book',                desc: 'Monthly register of all sales / OR issued' },
  { code: 'PB',  label: 'Purchase Book',             desc: 'Monthly register of all purchases / AP bills' },
  { code: 'GJ',  label: 'General Journal',           desc: 'All journal entries for the month' },
  { code: 'CVB', label: 'Cash Voucher Book',         desc: 'Disbursements made via cash vouchers' },
  { code: 'CRB', label: 'Cash Receipts Book',        desc: 'Cash collections received' },
  { code: 'CDB', label: 'Cash Disbursements Book',   desc: 'Cash disbursements register' },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function BirBooksPage() {
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<BookGeneration[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState<string | null>(null);

  const [form, setForm] = useState({
    book_type: 'SB',
    period_year: new Date().getFullYear(),
    period_month: String(new Date().getMonth() + 1),
  });

  useEffect(() => {
    const stored = localStorage.getItem('selected_company_id');
    if (stored) setCompanyId(stored);
  }, []);

  useEffect(() => { if (companyId) load(); }, [companyId, filterYear]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/bir/books?company_id=${companyId}&year=${filterYear}`) as BookGeneration[];
      setRows(Array.isArray(res) ? res : []);
    } catch { setRows([]); } finally { setLoading(false); }
  }

  async function generate() {
    setSaving(true); setError('');
    try {
      await api.post('/api/v1/bir/books', {
        ...form,
        company_id: companyId,
        period_month: form.period_month ? parseInt(form.period_month) : null,
      });
      setShowNew(false);
      load();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function finalize(id: string) {
    setFinalizing(id);
    try {
      await api.patch(`/api/v1/bir/books/${id}`, { action: 'finalize' });
      load();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setFinalizing(null); }
  }

  const statusColor = (s: string) => s === 'final'
    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';

  const bookLabel = (code: string) => BOOK_TYPES.find((b) => b.code === code)?.label ?? code;
  const periodLabel = (b: BookGeneration) => {
    if (b.period_month) return `${MONTHS[b.period_month - 1]} ${b.period_year}`;
    if (b.period_quarter) return `Q${b.period_quarter} ${b.period_year}`;
    return String(b.period_year);
  };

  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Books of Accounts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Generate and finalize subsidiary books per RR 9-2009</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + Generate Book
        </button>
      </div>

      {/* Book type cards */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {BOOK_TYPES.map((b) => {
          const count = rows.filter((r) => r.book_type === b.code).length;
          const hasFinal = rows.some((r) => r.book_type === b.code && r.status === 'final');
          return (
            <div key={b.code} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{b.code}</span>
                {hasFinal && <span className="rounded-full bg-green-100 dark:bg-green-900 px-1.5 py-0.5 text-xs text-green-700 dark:text-green-300">Has Final</span>}
              </div>
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{b.label}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{b.desc}</div>
              <div className="mt-2 text-xs text-slate-400">{count} generation{count !== 1 ? 's' : ''} this year</div>
            </div>
          );
        })}
      </div>

      <div className="mb-4 flex gap-2">
        <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              {['Book','Period','Rows','Total Amount','Generated','Status',''].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No books generated for {filterYear}.</td></tr>}
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">{b.book_type}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{bookLabel(b.book_type)}</div>
                </td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">{periodLabel(b)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{b.row_count.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">{b.total_amount.toFixed(2)}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {new Date(b.generated_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(b.status)}`}>{b.status}</span>
                </td>
                <td className="px-3 py-2">
                  {b.status === 'draft' && (
                    <button onClick={() => finalize(b.id)} disabled={finalizing === b.id}
                      className="text-xs text-green-700 hover:underline dark:text-green-400 disabled:opacity-50">
                      {finalizing === b.id ? 'Finalizing…' : 'Finalize'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {/* Generate modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white dark:bg-slate-900 shadow-xl p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">Generate Book</h2>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Book Type</label>
                <select value={form.book_type} onChange={(e) => setForm((f) => ({ ...f, book_type: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
                  {BOOK_TYPES.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Year</label>
                  <input type="number" value={form.period_year} onChange={(e) => setForm((f) => ({ ...f, period_year: parseInt(e.target.value) }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Month</label>
                  <select value={form.period_month} onChange={(e) => setForm((f) => ({ ...f, period_month: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
                    {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Generating a draft book will pull live data. You can regenerate drafts.
                Once finalized, the book is locked.
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setShowNew(false); setError(''); }}
                className="rounded px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300">Cancel</button>
              <button onClick={generate} disabled={saving}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
