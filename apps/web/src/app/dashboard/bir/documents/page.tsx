"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Pagination } from '@/components/Pagination';
import type { IssuedDocument } from '@perpet/shared';

const PAGE_SIZE = 15;
const DOC_TYPES = ['OR', 'SI', 'AR', 'DR', 'CI', 'CR'];
const DOC_TYPE_LABELS: Record<string, string> = {
  OR: 'Official Receipt', SI: 'Sales Invoice', AR: 'Acknowledgment Receipt',
  DR: 'Delivery Receipt', CI: 'Collection Invoice', CR: 'Credit Memo',
};

export default function BirDocumentsPage() {
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<IssuedDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [showNew, setShowNew] = useState(false);

  // New document form
  const [form, setForm] = useState({
    document_type: 'OR', transaction_date: new Date().toISOString().slice(0, 10),
    customer_name: '', customer_tin: '', customer_address: '',
    is_vat_registered: false,
    sc_pwd_type: '', sc_pwd_id_number: '',
    lines: [{ description: '', quantity: 1, unit_price: 0, vatable_amount: 0, vat_amount: 0, line_total: 0 }],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<IssuedDocument | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('selected_company_id');
    if (stored) setCompanyId(stored);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, page, filterType, filterStatus, filterFrom, filterTo]);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        company_id: companyId,
        limit: '500', offset: '0',
        ...(filterType && { document_type: filterType }),
        ...(filterStatus && { status: filterStatus }),
        ...(filterFrom && { date_from: filterFrom }),
        ...(filterTo && { date_to: filterTo }),
      });
      const res = await api.get(`/api/v1/bir/documents?${qs}`) as { data: IssuedDocument[]; total: number };
      setRows(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function updateLine(idx: number, field: string, value: string | number) {
    const lines = [...form.lines];
    (lines[idx] as Record<string, unknown>)[field] = value;
    // Auto-compute vat and totals
    const l = lines[idx];
    const qty = Number(l.quantity);
    const price = Number(l.unit_price);
    const gross = qty * price;
    if (form.is_vat_registered) {
      l.vatable_amount = parseFloat((gross / 1.12).toFixed(2));
      l.vat_amount = parseFloat((gross - l.vatable_amount).toFixed(2));
    } else {
      l.vatable_amount = 0;
      l.vat_amount = 0;
    }
    l.line_total = parseFloat(gross.toFixed(2));
    setForm((f) => ({ ...f, lines }));
  }

  async function save() {
    setSaving(true); setError('');
    try {
      await api.post('/api/v1/bir/documents', { ...form, company_id: companyId });
      setShowNew(false);
      setForm({
        document_type: 'OR', transaction_date: new Date().toISOString().slice(0, 10),
        customer_name: '', customer_tin: '', customer_address: '',
        is_vat_registered: false, sc_pwd_type: '', sc_pwd_id_number: '',
        lines: [{ description: '', quantity: 1, unit_price: 0, vatable_amount: 0, vat_amount: 0, line_total: 0 }],
      });
      setPage(1); load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function voidDoc() {
    if (!selected || !voidReason.trim()) return;
    setVoiding(true);
    try {
      await api.patch(`/api/v1/bir/documents/${selected.id}`, { void_reason: voidReason });
      setSelected(null); setVoidReason('');
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setVoiding(false);
    }
  }

  const statusColor = (s: string) => ({
    active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    void: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    cancelled: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300',
  }[s] ?? 'bg-slate-100 text-slate-600');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Issued Documents</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Official receipts, sales invoices, and other BIR-registered documents</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + New Document
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
          <option value="">All Types</option>
          {DOC_TYPES.map((t) => <option key={t} value={t}>{t} — {DOC_TYPE_LABELS[t]}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="void">Void</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
        <input type="date" value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <tr>
              {['Date', 'Type', 'Document No.', 'Customer', 'TIN', 'Total', 'VAT', 'Net', 'Status', ''].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400 dark:text-slate-500">Loading…</td></tr>
            )}
            {!loading && paged.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400 dark:text-slate-500">No documents found.</td></tr>
            )}
            {paged.map((d) => (
              <tr key={d.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">{d.transaction_date}</td>
                <td className="px-3 py-2">
                  <span className="rounded bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:text-blue-200">{d.document_type}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-800 dark:text-slate-200">{d.document_no}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{d.customer_name}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{d.customer_tin ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">{d.total_amount.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{d.vat_amount.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-200">{d.net_amount.toFixed(2)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(d.status)}`}>{d.status}</span>
                </td>
                <td className="px-3 py-2">
                  {d.status === 'active' && (
                    <button onClick={() => setSelected(d)}
                      className="text-xs text-red-600 hover:underline dark:text-red-400">Void</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      {/* New document modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-12 px-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-lg bg-white dark:bg-slate-900 shadow-xl p-6 mb-12">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">Issue New Document</h2>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Document Type</label>
                <select value={form.document_type} onChange={(e) => setForm((f) => ({ ...f, document_type: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{t} — {DOC_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Date</label>
                <input type="date" value={form.transaction_date} onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Customer Name *</label>
                <input type="text" value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                  placeholder="Customer name as printed on document" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Customer TIN</label>
                <input type="text" value={form.customer_tin} onChange={(e) => setForm((f) => ({ ...f, customer_tin: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                  placeholder="000-000-000-000" />
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.is_vat_registered}
                    onChange={(e) => setForm((f) => ({ ...f, is_vat_registered: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300" />
                  VAT Registered Customer
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">SC/PWD Type (if applicable)</label>
                <select value={form.sc_pwd_type} onChange={(e) => setForm((f) => ({ ...f, sc_pwd_type: e.target.value }))}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100">
                  <option value="">None</option>
                  <option value="SC">Senior Citizen</option>
                  <option value="PWD">PWD</option>
                </select>
              </div>
              {form.sc_pwd_type && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">SC/PWD ID Number</label>
                  <input type="text" value={form.sc_pwd_id_number} onChange={(e) => setForm((f) => ({ ...f, sc_pwd_id_number: e.target.value }))}
                    className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100" />
                </div>
              )}
            </div>

            {/* Lines */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Line Items</span>
                <button onClick={() => setForm((f) => ({
                  ...f,
                  lines: [...f.lines, { description: '', quantity: 1, unit_price: 0, vatable_amount: 0, vat_amount: 0, line_total: 0 }],
                }))} className="text-xs text-blue-600 hover:underline dark:text-blue-400">+ Add Line</button>
              </div>
              <div className="space-y-2">
                {form.lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1">
                    <input type="text" value={l.description} onChange={(e) => updateLine(i, 'description', e.target.value)}
                      placeholder="Description" className="col-span-5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100" />
                    <input type="number" value={l.quantity} onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))}
                      placeholder="Qty" className="col-span-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100" />
                    <input type="number" value={l.unit_price} onChange={(e) => updateLine(i, 'unit_price', Number(e.target.value))}
                      placeholder="Price" className="col-span-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100" />
                    <div className="col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs text-right font-mono text-slate-600 dark:text-slate-400">
                      {l.line_total.toFixed(2)}
                    </div>
                    {form.lines.length > 1 && (
                      <button onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}
                        className="col-span-1 text-red-500 hover:text-red-700 text-xs">✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="mb-4 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs space-y-1">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Vatable Amount</span>
                <span className="font-mono">{form.lines.reduce((s, l) => s + l.vatable_amount, 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>VAT (12%)</span>
                <span className="font-mono">{form.lines.reduce((s, l) => s + l.vat_amount, 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-semibold text-slate-800 dark:text-slate-200 border-t border-slate-200 dark:border-slate-700 pt-1">
                <span>Total Amount</span>
                <span className="font-mono">{form.lines.reduce((s, l) => s + l.line_total, 0).toFixed(2)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowNew(false); setError(''); }}
                className="rounded px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Issue Document'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white dark:bg-slate-900 shadow-xl p-6">
            <h2 className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">Void Document</h2>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
              Voiding <strong>{selected.document_no}</strong> is irreversible per BIR rules.
            </p>
            {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Void Reason *</label>
            <textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={3}
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 mb-4" />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setSelected(null); setVoidReason(''); setError(''); }}
                className="rounded px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300">Cancel</button>
              <button onClick={voidDoc} disabled={voiding || !voidReason.trim()}
                className="rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {voiding ? 'Voiding…' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
