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
  bill_id: string;
  bill_no: string;
  internal_no: string;
  bill_date: string;
  supplier_id: string;
  supplier_name: string;
  supplier_tin: string | null;
  supplier_address: string | null;
  company_name: string;
  company_tin: string | null;
  company_address: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft:  'bg-slate-100 text-slate-700',
  issued: 'bg-blue-100 text-blue-700',
  filed:  'bg-emerald-100 text-emerald-700',
};

// Quarter start/end dates
function quarterPeriod(year: number, quarter: number) {
  const starts = ['01/01', '04/01', '07/01', '10/01'];
  const ends   = ['03/31', '06/30', '09/30', '12/31'];
  return {
    from: `${starts[quarter - 1]}/${year}`,
    to:   `${ends[quarter - 1]}/${year}`,
  };
}

// Month labels per quarter position
const QUARTER_MONTH_LABELS: Record<number, [string, string, string]> = {
  1: ['January', 'February', 'March'],
  2: ['April', 'May', 'June'],
  3: ['July', 'August', 'September'],
  4: ['October', 'November', 'December'],
};

// Given bill date, return which month-of-quarter (1, 2, or 3) it belongs to
function monthOfQuarter(billDate: string, quarter: number): 1 | 2 | 3 {
  const month = new Date(billDate).getMonth() + 1; // 1-12
  const firstMonth = (quarter - 1) * 3 + 1;
  const pos = month - firstMonth + 1;
  return (Math.min(Math.max(pos, 1), 3)) as 1 | 2 | 3;
}

function fmt(n: number) { return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtTin(tin: string | null) { return tin ?? ''; }

const border = 'border border-black';
const td = `${border} px-1.5 py-1 text-[9px]`;
const th = `${border} px-1.5 py-1 text-[8px] font-bold text-center`;

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
    try { await api.patch(`/bir/certificates/${id}`, { status }); load(); }
    catch (e: unknown) { setMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!cert) return <div className="py-10 text-center text-sm text-red-600">Certificate not found</div>;

  const { from, to } = quarterPeriod(cert.period_year, cert.period_quarter);
  const mPos = monthOfQuarter(cert.bill_date, cert.period_quarter);
  const monthLabels = QUARTER_MONTH_LABELS[cert.period_quarter];
  const m1 = mPos === 1 ? cert.taxable_amount : 0;
  const m2 = mPos === 2 ? cert.taxable_amount : 0;
  const m3 = mPos === 3 ? cert.taxable_amount : 0;

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/bir/certificates" className="text-sm text-slate-500 hover:text-slate-700">← Certificates</Link>
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[cert.status] ?? STATUS_STYLES.draft}`}>{cert.status}</span>
        </div>
        <div className="flex gap-2">
          {cert.status === 'draft' && (
            <button onClick={() => updateStatus('issued')} disabled={busy}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Mark as Issued</button>
          )}
          {cert.status === 'issued' && (
            <button onClick={() => updateStatus('filed')} disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Mark as Filed</button>
          )}
          <button onClick={() => window.print()}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Print / Save PDF
          </button>
          <Link href={`/dashboard/ap/bills/${cert.bill_id}`}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            View Bill
          </Link>
        </div>
      </div>
      {msg && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">{msg}</div>}

      {/* ───────────────── BIR FORM 2307 ───────────────── */}
      <div id="form2307"
        className="mx-auto bg-white text-black print:shadow-none"
        style={{ width: '210mm', minHeight: '297mm', fontFamily: 'Arial, sans-serif', fontSize: '9px', padding: '8mm 8mm 8mm 8mm' }}>

        {/* TOP HEADER ROW */}
        <div className="flex items-start justify-between mb-0.5">
          <div className="text-[8px] leading-tight">
            <div>For BIR</div>
            <div>Use Only</div>
            <div className="mt-0.5">BCS/</div>
            <div>Item:</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-[8px]">Republic of the Philippines</div>
            <div className="text-[9px] font-bold">Department of Finance</div>
            <div className="text-[9px] font-bold">Bureau of Internal Revenue</div>
          </div>
          <div className="text-right text-[8px] leading-tight">
            <div className="text-[8px]">BIR Form No.</div>
            <div className="text-[28px] font-bold leading-none">2307</div>
            <div className="text-[7px]">January 2018 (ENCS)</div>
          </div>
        </div>

        {/* TITLE */}
        <div className="border-2 border-black text-center py-1 mb-0.5">
          <div className="text-[14px] font-bold">Certificate of Creditable Tax</div>
          <div className="text-[14px] font-bold">Withheld at Source</div>
        </div>

        <div className="text-[7px] mb-1">Fill in all applicable spaces. Mark all appropriate boxes with an "X".</div>

        {/* FIELD 1 — For the Period */}
        <table className="w-full border-collapse mb-0.5">
          <tbody>
            <tr>
              <td className={`${border} px-1 py-0.5 w-8 text-[8px] font-bold`}>1</td>
              <td className={`${border} px-1 py-0.5 text-[8px]`}>
                For the Period &nbsp;&nbsp;
                <span className="font-bold">From</span>&nbsp;
                <span className="inline-block border-b border-black px-2 text-[8px]">{from}</span>
                &nbsp;&nbsp;<span className="font-bold">To</span>&nbsp;
                <span className="inline-block border-b border-black px-2 text-[8px]">{to}</span>
                &nbsp;<span className="text-[7px] text-gray-500">(MM/DD/YYYY)</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* PART I — PAYEE */}
        <div className={`${border} text-center text-[8px] font-bold py-0.5 bg-gray-100`}>Part I – Payee Information</div>
        <table className="w-full border-collapse">
          <tbody>
            <tr>
              <td className={`${border} px-1 py-0.5 w-8 text-[8px] font-bold align-top`}>2</td>
              <td className={`${border} px-1 py-1`}>
                <div className="text-[7px] text-gray-500">Taxpayer Identification Number (TIN)</div>
                <div className="text-[9px] font-mono mt-0.5 tracking-widest">{fmtTin(cert.supplier_tin)}</div>
              </td>
            </tr>
            <tr>
              <td className={`${border} px-1 py-0.5 w-8 text-[8px] font-bold align-top`}>3</td>
              <td className={`${border} px-1 py-1`}>
                <div className="text-[7px] text-gray-500">Payee's Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)</div>
                <div className="text-[9px] font-bold mt-0.5">{cert.supplier_name}</div>
              </td>
            </tr>
            <tr>
              <td className={`${border} px-1 py-0.5 w-8 text-[8px] font-bold align-top`}>4</td>
              <td className={`${border} px-1 py-1`}>
                <div className="text-[7px] text-gray-500">Registered Address</div>
                <div className="text-[9px] mt-0.5">{cert.supplier_address ?? ''}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* PART II — PAYOR */}
        <div className={`${border} text-center text-[8px] font-bold py-0.5 bg-gray-100 mt-0.5`}>Part II – Payor Information</div>
        <table className="w-full border-collapse">
          <tbody>
            <tr>
              <td className={`${border} px-1 py-0.5 w-8 text-[8px] font-bold align-top`}>6</td>
              <td className={`${border} px-1 py-1`}>
                <div className="text-[7px] text-gray-500">Taxpayer Identification Number (TIN)</div>
                <div className="text-[9px] font-mono mt-0.5 tracking-widest">{fmtTin(cert.company_tin)}</div>
              </td>
            </tr>
            <tr>
              <td className={`${border} px-1 py-0.5 w-8 text-[8px] font-bold align-top`}>7</td>
              <td className={`${border} px-1 py-1`}>
                <div className="text-[7px] text-gray-500">Payor's Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)</div>
                <div className="text-[9px] font-bold mt-0.5">{cert.company_name}</div>
              </td>
            </tr>
            <tr>
              <td className={`${border} px-1 py-0.5 w-8 text-[8px] font-bold align-top`}>8</td>
              <td className={`${border} px-1 py-1`}>
                <div className="text-[7px] text-gray-500">Registered Address</div>
                <div className="text-[9px] mt-0.5">{cert.company_address ?? ''}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* PART III — INCOME PAYMENTS TABLE */}
        <div className={`${border} text-center text-[8px] font-bold py-0.5 bg-gray-100 mt-0.5`}>
          Part III – Details of Monthly Income Payments and Taxes Withheld
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} w-1/3`} rowSpan={2}>Income Payments Subject to Expanded Withholding Tax</th>
              <th className={`${th} w-10`} rowSpan={2}>ATC</th>
              <th className={`${th}`} colSpan={3}>AMOUNT OF INCOME PAYMENTS</th>
              <th className={`${th} w-20`} rowSpan={2}>Total</th>
              <th className={`${th} w-20`} rowSpan={2}>Tax Withheld for the Quarter</th>
            </tr>
            <tr>
              <th className={th}>1st Month of the Quarter<br/><span className="font-normal text-[7px]">({monthLabels[0]})</span></th>
              <th className={th}>2nd Month of the Quarter<br/><span className="font-normal text-[7px]">({monthLabels[1]})</span></th>
              <th className={th}>3rd Month of the Quarter<br/><span className="font-normal text-[7px]">({monthLabels[2]})</span></th>
            </tr>
          </thead>
          <tbody>
            {/* Main data row */}
            <tr>
              <td className={`${td} text-left`}>
                {cert.atc_description ?? cert.bir_atc_code}
                <div className="text-[7px] text-gray-500 mt-0.5">Ref: {cert.internal_no} / {cert.bill_no} ({formatDate(cert.bill_date)})</div>
              </td>
              <td className={`${td} text-center font-bold`}>{cert.bir_atc_code}</td>
              <td className={`${td} text-right font-mono`}>{m1 > 0 ? fmt(m1) : ''}</td>
              <td className={`${td} text-right font-mono`}>{m2 > 0 ? fmt(m2) : ''}</td>
              <td className={`${td} text-right font-mono`}>{m3 > 0 ? fmt(m3) : ''}</td>
              <td className={`${td} text-right font-mono font-bold`}>{fmt(cert.taxable_amount)}</td>
              <td className={`${td} text-right font-mono font-bold`}>{fmt(cert.amount_withheld)}</td>
            </tr>
            {/* Empty filler rows to match the form layout */}
            {[...Array(7)].map((_, i) => (
              <tr key={i}>
                <td className={`${td} h-4`}></td>
                <td className={td}></td>
                <td className={td}></td>
                <td className={td}></td>
                <td className={td}></td>
                <td className={td}></td>
                <td className={td}></td>
              </tr>
            ))}
            {/* Total row */}
            <tr className="bg-gray-50">
              <td className={`${td} font-bold`} colSpan={2}>Total</td>
              <td className={`${td} text-right font-mono font-bold`}>{m1 > 0 ? fmt(m1) : ''}</td>
              <td className={`${td} text-right font-mono font-bold`}>{m2 > 0 ? fmt(m2) : ''}</td>
              <td className={`${td} text-right font-mono font-bold`}>{m3 > 0 ? fmt(m3) : ''}</td>
              <td className={`${td} text-right font-mono font-bold`}>{fmt(cert.taxable_amount)}</td>
              <td className={`${td} text-right font-mono font-bold`}>{fmt(cert.amount_withheld)}</td>
            </tr>
            {/* Money Payments section */}
            <tr className="bg-gray-100">
              <td className={`${td} font-bold text-[8px]`} colSpan={7}>Money Payments Subject to Withholding of Business Tax (Government &amp; Private)</td>
            </tr>
            {[...Array(5)].map((_, i) => (
              <tr key={i}>
                <td className={`${td} h-4`}></td>
                <td className={td}></td>
                <td className={td}></td>
                <td className={td}></td>
                <td className={td}></td>
                <td className={td}></td>
                <td className={td}></td>
              </tr>
            ))}
            <tr className="bg-gray-50">
              <td className={`${td} font-bold`} colSpan={2}>Total</td>
              <td className={td}></td>
              <td className={td}></td>
              <td className={td}></td>
              <td className={td}></td>
              <td className={td}></td>
            </tr>
          </tbody>
        </table>

        {/* CERTIFICATION */}
        <div className={`${border} px-2 py-2 mt-0.5 text-[7px] leading-tight`}>
          We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. Further, we give our consent to the processing of our information as contemplated under the *Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.
        </div>

        {/* SIGNATURES */}
        <table className="w-full border-collapse mt-0.5">
          <tbody>
            <tr>
              <td className={`${border} px-2 py-6 text-center w-1/2`}>
                <div className="border-t border-black mt-4 pt-1 text-[8px]">
                  Signature over Printed Name of Payor/Payor&apos;s Authorized Representative/Tax Agent
                </div>
                <div className="text-[7px] text-gray-500">(Indicate Title/Designation and TIN)</div>
                <div className="mt-2 flex gap-4 text-[7px]">
                  <div>
                    <div>Tax Agent Accreditation No./</div>
                    <div>Attorney&apos;s Roll No. (if applicable)</div>
                  </div>
                  <div>
                    <div>Date of Issue <span className="border-b border-black px-3">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
                    <div className="text-[6px] text-gray-400">(MM/DD/YYYY)</div>
                  </div>
                  <div>
                    <div>Date of Expiry <span className="border-b border-black px-3">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
                    <div className="text-[6px] text-gray-400">(MM/DD/YYYY)</div>
                  </div>
                </div>
              </td>
              <td className={`${border} px-2 w-1/2 align-middle`}>
                <div className="text-center font-bold text-[8px] mb-2">CONFORME:</div>
                <div className="border-t border-black mt-4 pt-1 text-[8px] text-center">
                  Signature over Printed Name of Payee/Payee&apos;s Authorized Representative/Tax Agent
                </div>
                <div className="text-[7px] text-gray-500 text-center">(Indicate Title/Designation and TIN)</div>
                <div className="mt-2 flex gap-4 text-[7px] justify-center">
                  <div>
                    <div>Tax Agent Accreditation No./</div>
                    <div>Attorney&apos;s Roll No. (if applicable)</div>
                  </div>
                  <div>
                    <div>Date of Issue <span className="border-b border-black px-3">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
                    <div className="text-[6px] text-gray-400">(MM/DD/YYYY)</div>
                  </div>
                  <div>
                    <div>Date of Expiry <span className="border-b border-black px-3">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
                    <div className="text-[6px] text-gray-400">(MM/DD/YYYY)</div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="text-[6px] text-gray-500 mt-0.5">
          *NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)
        </div>

        {/* Internal reference — hidden when printing */}
        <div className="mt-3 print:hidden border-t border-slate-200 pt-3 text-xs text-slate-500">
          <span className="font-medium text-slate-700">Internal Ref:</span> {cert.cert_no} &nbsp;·&nbsp;
          <span className="font-medium text-slate-700">Bill:</span> {cert.internal_no} ({cert.bill_no}) &nbsp;·&nbsp;
          <span className="font-medium text-slate-700">Generated:</span> {formatDate(cert.created_at)}
          {cert.issued_at && <span> &nbsp;·&nbsp; <span className="font-medium text-slate-700">Issued:</span> {formatDate(cert.issued_at)}</span>}
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #form2307, #form2307 * { visibility: visible; }
          #form2307 { position: absolute; left: 0; top: 0; width: 210mm; }
          @page { size: A4; margin: 0; }
        }
      `}</style>
    </div>
  );
}
