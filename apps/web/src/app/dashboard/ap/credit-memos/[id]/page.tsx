'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP, formatDate } from '@/lib/format';

interface CMLine {
  id: string; line_no: number; description: string;
  quantity: number; unit_price: number; vat_rate: number;
  line_subtotal: number; line_vat: number; line_total: number;
  account_name: string | null; account_code: string | null;
  branch_code: string | null; building_code: string | null;
  cost_center_code: string | null; grow_ref_code: string | null;
}

interface CreditMemo {
  id: string; memo_no: string; memo_date: string;
  status: string; reason: string | null; notes: string | null;
  supplier_id: string; supplier_name: string; supplier_code: string;
  supplier_address: string | null;
  bill_id: string | null; linked_bill_no: string | null;
  subtotal: number; vat_amount: number; total: number;
  amount_applied: number; balance: number;
  je_id: string | null;
  branch_code: string | null; branch_name: string | null;
  building_code: string | null; building_name: string | null;
  cost_center_code: string | null; cost_center_name: string | null;
  grow_ref_code: string | null; grow_ref_name: string | null;
  lines: CMLine[];
}

const STATUS_STYLES: Record<string, string> = {
  draft:  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  posted: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  voided: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100">{value || <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

export default function CreditMemoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [cm, setCm]           = useState<CreditMemo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setLoadError(null);
    try {
      const data = await api.get<CreditMemo>(`/ap/credit-memos/${id}`);
      setCm(data);
    } catch (e: unknown) { setLoadError((e as Error).message ?? 'Failed to load'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function doPost() {
    if (!window.confirm('Post this credit memo? A journal entry will be created.')) return;
    setBusy(true); setMsg(null);
    try {
      await api.post(`/ap/credit-memos/${id}/post`);
      void load();
    } catch (e: unknown) { setMsg((e as Error).message ?? 'Post failed'); }
    finally { setBusy(false); }
  }

  async function doDelete() {
    if (!window.confirm('Delete this credit memo? This cannot be undone.')) return;
    setBusy(true); setMsg(null);
    try {
      await api.delete(`/ap/credit-memos/${id}`);
      router.push('/dashboard/ap/credit-memos');
    } catch (e: unknown) { setMsg((e as Error).message ?? 'Delete failed'); setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (loadError || !cm) return <div className="py-10 text-center text-sm text-red-600">{loadError ?? 'Credit memo not found'}</div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{cm.memo_no}</h1>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[cm.status] ?? STATUS_STYLES.draft}`}>
              {cm.status}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            <Link href={`/dashboard/purchasing/suppliers/${cm.supplier_id}`} className="hover:underline">
              {cm.supplier_name}
            </Link>
          </p>
        </div>
        <Link href="/dashboard/ap/credit-memos"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          ← Back to list
        </Link>
      </div>

      {msg && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {msg}
        </div>
      )}

      {/* Details */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">Credit Memo Details</div>
        <div className="grid grid-cols-4 gap-x-6 gap-y-4">
          <div className="col-span-2">
            <Field label="Supplier" value={`${cm.supplier_code} — ${cm.supplier_name}`} />
          </div>
          <Field label="Memo Date" value={formatDate(cm.memo_date)} />
          <Field label="Linked Bill" value={
            cm.bill_id
              ? <Link href={`/dashboard/ap/bills/${cm.bill_id}`} className="font-mono text-brand-700 hover:underline dark:text-brand-400">{cm.linked_bill_no ?? cm.bill_id}</Link>
              : null
          } />
          {cm.supplier_address && (
            <div className="col-span-4">
              <Field label="Supplier Address" value={cm.supplier_address} />
            </div>
          )}
          {cm.reason && <div className="col-span-2"><Field label="Reason" value={cm.reason} /></div>}
          {cm.notes && <div className="col-span-2"><Field label="Notes" value={cm.notes} /></div>}
          {(cm.branch_code || cm.building_code || cm.cost_center_code || cm.grow_ref_code) && (
            <>
              {cm.branch_code && <Field label="Branch" value={`${cm.branch_code} — ${cm.branch_name}`} />}
              {cm.building_code && <Field label="Building" value={`${cm.building_code} — ${cm.building_name}`} />}
              {cm.cost_center_code && <Field label="Cost Center" value={`${cm.cost_center_code} — ${cm.cost_center_name}`} />}
              {cm.grow_ref_code && <Field label="Grow Reference" value={`${cm.grow_ref_code} — ${cm.grow_ref_name}`} />}
            </>
          )}
        </div>
      </div>

      {/* Line Items */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Line Items
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-8">#</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-left font-medium w-40">Account</th>
                <th className="px-3 py-2 text-right font-medium w-16">Qty</th>
                <th className="px-3 py-2 text-right font-medium w-28">Unit Price</th>
                <th className="px-3 py-2 text-right font-medium w-12">VAT%</th>
                <th className="px-3 py-2 text-right font-medium w-28">Subtotal</th>
                <th className="px-3 py-2 text-right font-medium w-24">VAT</th>
                <th className="px-3 py-2 text-right font-medium w-28">Total</th>
                <th className="px-3 py-2 text-left font-medium w-16">Branch</th>
                <th className="px-3 py-2 text-left font-medium w-16">Building</th>
                <th className="px-3 py-2 text-left font-medium w-20">Cost Center</th>
                <th className="px-3 py-2 text-left font-medium w-16">Grow</th>
              </tr>
            </thead>
            <tbody>
              {cm.lines?.map(l => (
                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 text-slate-400">{l.line_no}</td>
                  <td className="px-3 py-2 dark:text-slate-300">{l.description}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                    {l.account_code ? <span className="font-mono">{l.account_code}</span> : <span className="text-slate-400">—</span>}
                    {l.account_name && <span className="ml-1 text-slate-400">({l.account_name})</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{l.quantity}</td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(l.unit_price)}</td>
                  <td className="px-3 py-2 text-right dark:text-slate-300">{l.vat_rate}%</td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(l.line_subtotal)}</td>
                  <td className="px-3 py-2 text-right font-mono dark:text-slate-300">{formatPHP(l.line_vat)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold dark:text-slate-300">{formatPHP(l.line_total)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.branch_code ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.building_code ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.cost_center_code ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{l.grow_ref_code ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={6} className="px-3 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">Subtotal</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs dark:text-slate-300">{formatPHP(cm.subtotal)}</td>
                <td colSpan={6} />
              </tr>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={6} className="px-3 py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">VAT</td>
                <td colSpan={2} className="px-3 py-1.5 text-right font-mono text-xs dark:text-slate-300">{formatPHP(cm.vat_amount)}</td>
                <td colSpan={5} />
              </tr>
              <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <td colSpan={8} className="px-3 py-2 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">Total Credit</td>
                <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{formatPHP(cm.total)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          {cm.status === 'draft' && (
            <button onClick={doPost} disabled={busy}
              className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'Posting…' : 'Post'}
            </button>
          )}
          {cm.je_id && (
            <Link href={`/dashboard/gl/journal-entries/${cm.je_id}`}
              className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              View Journal Entry
            </Link>
          )}
          <button onClick={() => router.back()}
            className="rounded border border-slate-300 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            Back
          </button>
        </div>
        {cm.status === 'draft' && (
          <button onClick={doDelete} disabled={busy}
            className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-950 dark:text-red-400">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
