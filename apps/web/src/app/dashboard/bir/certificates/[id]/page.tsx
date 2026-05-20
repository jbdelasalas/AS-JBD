'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Cert {
  id: string;
  cert_no: string;
  status: string;
  period_year: number;
  period_quarter: number;
  bir_atc_code: string;
  atc_description: string | null;
  taxable_amount: number;
  rate_pct: number;
  amount_withheld: number;
  issued_at: string | null;
  filed_at: string | null;
  created_at: string;
  // Bill
  bill_id: string;
  bill_no: string;
  internal_no: string;
  bill_date: string;
  // Supplier (payee)
  supplier_id: string;
  supplier_name: string;
  supplier_tin: string | null;
  supplier_address: string | null;
  // Company (payor)
  company_name: string;
  company_tin: string | null;
  company_address: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft:  'bg-slate-100 text-slate-700',
  issued: 'bg-blue-100 text-blue-700',
  filed:  'bg-emerald-100 text-emerald-700',
};

const QUARTER_MONTHS: Record<number, string> = {
  1: 'January – March',
  2: 'April – June',
  3: 'July – September',
  4: 'October – December',
};

export default function CertificateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [cert, setCert] = useState<Cert | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Cert>(`/bir/certificates/${id}`).then(setCert).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(status: string) {
    setBusy(true); setMsg(null);
    try {
      await api.patch(`/bir/certificates/${id}`, { status });
      load();
    } catch (e: unknown) { setMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!cert) return <div className="py-10 text-center text-sm text-red-600">Certificate not found</div>;

  const netPayable = cert.taxable_amount - cert.amount_withheld;

  return (
    <div>
      {/* Toolbar — hidden when printing */}
      <div className="mb-5 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/bir/certificates"
            className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400">
            ← Certificates
          </Link>
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[cert.status] ?? STATUS_STYLES.draft}`}>
            {cert.status}
          </span>
        </div>
        <div className="flex gap-2">
          {cert.status === 'draft' && (
            <button onClick={() => updateStatus('issued')} disabled={busy}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
              Mark as Issued
            </button>
          )}
          {cert.status === 'issued' && (
            <button onClick={() => updateStatus('filed')} disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
              Mark as Filed
            </button>
          )}
          <button onClick={() => window.print()}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            Print / Save PDF
          </button>
          <Link href={`/dashboard/ap/bills/${cert.bill_id}`}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
            View Bill
          </Link>
        </div>
      </div>

      {msg && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">{msg}</div>}

      {/* BIR Form 2307 */}
      <div className="mx-auto max-w-3xl rounded-lg border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900 print:border-0 print:shadow-none">

        {/* Form header */}
        <div className="border-b border-slate-300 dark:border-slate-600 p-6 text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400">Republic of the Philippines</p>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">DEPARTMENT OF FINANCE — BUREAU OF INTERNAL REVENUE</p>
          <div className="mt-3">
            <h1 className="text-base font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">
              Certificate of Creditable Tax Withheld at Source
            </h1>
            <p className="mt-0.5 text-sm font-semibold text-slate-700 dark:text-slate-300">BIR Form No. 2307</p>
          </div>
          <div className="mt-3 flex justify-center gap-8 text-xs text-slate-600 dark:text-slate-400">
            <span><strong className="text-slate-800 dark:text-slate-200">Certificate No.:</strong> {cert.cert_no}</span>
            <span><strong className="text-slate-800 dark:text-slate-200">Period:</strong> Q{cert.period_quarter} {cert.period_year} ({QUARTER_MONTHS[cert.period_quarter]})</span>
          </div>
        </div>

        {/* Payor / Payee */}
        <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-700 border-b border-slate-300 dark:border-slate-600">
          {/* Payor */}
          <div className="p-5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Payor (Withholding Agent)
            </p>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{cert.company_name}</p>
            {cert.company_tin && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-medium">TIN:</span> {cert.company_tin}
              </p>
            )}
            {cert.company_address && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{cert.company_address}</p>
            )}
          </div>
          {/* Payee */}
          <div className="p-5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Payee (Income Recipient / Supplier)
            </p>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{cert.supplier_name}</p>
            {cert.supplier_tin && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-medium">TIN:</span> {cert.supplier_tin}
              </p>
            )}
            {cert.supplier_address && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{cert.supplier_address}</p>
            )}
          </div>
        </div>

        {/* Income payments table */}
        <div className="p-5">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Income Payments Subject to Expanded Withholding Tax
          </p>
          <table className="w-full text-sm border border-slate-200 dark:border-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
              <tr>
                <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-left font-medium">ATC</th>
                <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-left font-medium">Nature of Income Payment</th>
                <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-right font-medium">Gross Amount</th>
                <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-right font-medium">Rate</th>
                <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-right font-medium">Tax Withheld</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-slate-200 dark:border-slate-700 px-3 py-3 font-mono text-xs text-blue-700 dark:text-blue-300">
                  {cert.bir_atc_code}
                </td>
                <td className="border border-slate-200 dark:border-slate-700 px-3 py-3 text-xs text-slate-700 dark:text-slate-300">
                  {cert.atc_description ?? cert.bir_atc_code}
                </td>
                <td className="border border-slate-200 dark:border-slate-700 px-3 py-3 text-right font-mono text-xs text-slate-800 dark:text-slate-200">
                  {cert.taxable_amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
                <td className="border border-slate-200 dark:border-slate-700 px-3 py-3 text-right text-xs text-slate-700 dark:text-slate-300">
                  {cert.rate_pct}%
                </td>
                <td className="border border-slate-200 dark:border-slate-700 px-3 py-3 text-right font-mono text-xs font-semibold text-red-700 dark:text-red-400">
                  {cert.amount_withheld.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <td colSpan={4} className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Total EWT Withheld
                </td>
                <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-right font-mono text-sm font-bold text-red-700 dark:text-red-400">
                  {cert.amount_withheld.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
              </tr>
              <tr>
                <td colSpan={4} className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-right text-xs text-slate-500 dark:text-slate-400">
                  Net Payable to Supplier
                </td>
                <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-right font-mono text-xs text-slate-700 dark:text-slate-300">
                  {netPayable.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Source document */}
        <div className="border-t border-slate-200 dark:border-slate-700 px-5 py-4">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Source Document</p>
          <div className="flex flex-wrap gap-6 text-xs text-slate-600 dark:text-slate-400">
            <span><strong className="text-slate-800 dark:text-slate-200">Supplier Bill No.:</strong> {cert.bill_no}</span>
            <span><strong className="text-slate-800 dark:text-slate-200">Internal Ref.:</strong> {cert.internal_no}</span>
            <span><strong className="text-slate-800 dark:text-slate-200">Bill Date:</strong> {formatDate(cert.bill_date)}</span>
          </div>
        </div>

        {/* Signature / certification block */}
        <div className="border-t border-slate-200 dark:border-slate-700 px-5 py-5">
          <p className="mb-4 text-[11px] text-slate-500 dark:text-slate-400 italic">
            I/We hereby certify, under penalty of perjury, that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof.
          </p>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="border-b border-slate-400 dark:border-slate-500 pb-1" style={{ minHeight: '2rem' }} />
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Signature of Withholding Agent / Authorized Representative</p>
              <p className="mt-3 text-[10px] text-slate-500 dark:text-slate-400">Date: ________________________</p>
            </div>
            <div className="text-right text-xs text-slate-500 dark:text-slate-400">
              {cert.issued_at && (
                <p><span className="font-medium">Issued:</span> {formatDate(cert.issued_at)}</p>
              )}
              {cert.filed_at && (
                <p className="mt-1"><span className="font-medium">Filed:</span> {formatDate(cert.filed_at)}</p>
              )}
              <p className="mt-2 text-[10px]">Generated: {formatDate(cert.created_at)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
