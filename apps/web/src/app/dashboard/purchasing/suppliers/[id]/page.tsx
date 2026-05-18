'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface Supplier {
  id: string;
  code: string;
  name: string;
  supplier_type: string;
  tin: string | null;
  address: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  payment_terms_days: number;
  is_vat_registered: boolean;
  ewt_rate: number;
  is_active: boolean;
}

interface OpenBill {
  id: string;
  internal_no: string;
  bill_no: string;
  bill_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
}

interface Outstanding { total_balance: number; bills: OpenBill[]; }

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  partial: 'bg-orange-100 text-orange-700',
  paid: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-red-100 text-red-700',
};

const SUPPLIER_TYPES = ['trade', 'refinery', 'service', 'contractor'];

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [outstanding, setOutstanding] = useState<Outstanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Supplier>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<Supplier>(`/ap/suppliers/${id}`),
      api.get<Outstanding>(`/ap/suppliers/${id}/outstanding`),
    ]).then(([s, o]) => { setSupplier(s); setOutstanding(o); setForm(s); })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function set(field: string, val: unknown) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/ap/suppliers/${id}`, {
        name: form.name,
        supplier_type: form.supplier_type,
        tin: form.tin || null,
        address: form.address || null,
        contact_person: form.contact_person || null,
        email: form.email || null,
        phone: form.phone || null,
        payment_terms_days: Number(form.payment_terms_days),
        is_vat_registered: form.is_vat_registered,
        ewt_rate: Number(form.ewt_rate),
        is_active: form.is_active,
      });
      setSaved(true);
      setEditing(false);
      load();
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!supplier) return <div className="py-10 text-center text-sm text-red-600">Supplier not found</div>;

  const inp = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{supplier.name}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${supplier.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}>
              {supplier.is_active ? 'active' : 'inactive'}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{supplier.code} · {supplier.supplier_type}</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Edit
            </button>
          )}
          <Link href="/dashboard/ap/bills/new"
            className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">
            + New Bill
          </Link>
          <Link href="/dashboard/ap/payments/new"
            className="rounded border border-brand-600 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50 dark:text-brand-400">
            Record Payment
          </Link>
        </div>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {editing ? (
        <form onSubmit={save} className="mb-5 rounded-lg border border-brand-200 dark:border-brand-800 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Edit Supplier</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className={lbl}>Name *</label>
              <input required value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Type</label>
              <select value={form.supplier_type ?? 'trade'} onChange={(e) => set('supplier_type', e.target.value)} className={inp}>
                {SUPPLIER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>TIN</label>
              <input value={form.tin ?? ''} onChange={(e) => set('tin', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Phone</label>
              <input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Email</label>
              <input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Contact Person</label>
              <input value={form.contact_person ?? ''} onChange={(e) => set('contact_person', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Payment Terms (days)</label>
              <input type="number" min={0} value={form.payment_terms_days ?? 30}
                onChange={(e) => set('payment_terms_days', parseInt(e.target.value))} className={inp} />
            </div>
            <div>
              <label className={lbl}>EWT Rate (%)</label>
              <input type="number" min={0} max={100} step="any" value={form.ewt_rate ?? 0}
                onChange={(e) => set('ewt_rate', parseFloat(e.target.value))} className={inp} />
            </div>
            <div className="col-span-3">
              <label className={lbl}>Address</label>
              <input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} className={inp} />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={form.is_vat_registered ?? true} onChange={(e) => set('is_vat_registered', e.target.checked)} />
                VAT Registered
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={form.is_active ?? true} onChange={(e) => set('is_active', e.target.checked)} />
                Active
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit" disabled={saving}
              className="rounded bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setForm(supplier); setError(null); }}
              className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-4 gap-3">
            {[
              { label: 'TIN', value: supplier.tin ?? '—' },
              { label: 'Payment Terms', value: `${supplier.payment_terms_days} days` },
              { label: 'VAT Registered', value: supplier.is_vat_registered ? 'Yes' : 'No' },
              { label: 'EWT Rate', value: `${supplier.ewt_rate}%` },
            ].map((f) => (
              <div key={f.label} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500 dark:text-slate-400">{f.label}</div>
                <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{f.value}</div>
              </div>
            ))}
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3">
            {supplier.address && (
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500 dark:text-slate-400">Address</div>
                <div className="mt-0.5 text-sm text-slate-900 dark:text-slate-100">{supplier.address}</div>
              </div>
            )}
            <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-xs text-slate-500 dark:text-slate-400">Contact</div>
              <div className="mt-0.5 text-sm text-slate-900 dark:text-slate-100">{supplier.contact_person ?? '—'}</div>
              {supplier.email && <div className="text-xs text-slate-500 dark:text-slate-400">{supplier.email}</div>}
              {supplier.phone && <div className="text-xs text-slate-500 dark:text-slate-400">{supplier.phone}</div>}
            </div>
          </div>
        </>
      )}

      {outstanding && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-700">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Open Bills</div>
            <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              Total Balance: {formatPHP(outstanding.total_balance)}
            </div>
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Internal No.</th>
                <th className="px-3 py-2 text-left font-medium">Bill No.</th>
                <th className="px-3 py-2 text-left font-medium">Bill Date</th>
                <th className="px-3 py-2 text-left font-medium">Due Date</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.bills.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500">No open bills.</td></tr>
              ) : outstanding.bills.map((b) => (
                <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/ap/bills/${b.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">
                      {b.internal_no}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{b.bill_no}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(b.bill_date)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDate(b.due_date)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs dark:text-slate-300">{formatPHP(b.total)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-amber-700 dark:text-amber-400">{formatPHP(b.balance)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[b.status] ?? STATUS_STYLES.draft}`}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
