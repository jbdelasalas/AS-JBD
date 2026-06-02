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

const QUARTER_STARTS = ['01/01', '04/01', '07/01', '10/01'];
const QUARTER_ENDS   = ['03/31', '06/30', '09/30', '12/31'];
const QUARTER_MONTHS: Record<number,[string,string,string]> = {
  1: ['January','February','March'],
  2: ['April','May','June'],
  3: ['July','August','September'],
  4: ['October','November','December'],
};

function qFrom(y: number, q: number) { return `${QUARTER_STARTS[q-1]}/${y}`; }
function qTo(y: number, q: number)   { return `${QUARTER_ENDS[q-1]}/${y}`; }

function monthPos(billDate: string, q: number): 0|1|2 {
  const m = new Date(billDate).getMonth() + 1;
  const first = (q - 1) * 3 + 1;
  return Math.max(0, Math.min(2, m - first)) as 0|1|2;
}

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── Shared cell styles ─── */
const S = {
  cell:   { border: '1px solid black', padding: '2px 4px', fontSize: '8px' },
  hdr:    { border: '1px solid black', padding: '2px 4px', fontSize: '8px', fontWeight: 700, textAlign: 'center' as const, backgroundColor: '#e8e8e8' },
  num:    { border: '1px solid black', padding: '2px 3px', fontSize: '8px', fontWeight: 700, width: '14px', verticalAlign: 'top' as const, textAlign: 'center' as const },
  label:  { fontSize: '7px', color: '#555', display: 'block' as const },
  value:  { fontSize: '9px', fontWeight: 700, display: 'block' as const, marginTop: '1px' },
  normal: { fontSize: '9px', display: 'block' as const, marginTop: '1px' },
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
    try { await api.patch(`/bir/certificates/${id}`, { status }); load(); }
    catch (e: unknown) { setMsg((e as Error).message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!cert) return <div className="py-10 text-center text-sm text-red-600">Certificate not found</div>;

  const q = cert.period_quarter;
  const y = cert.period_year;
  const months = QUARTER_MONTHS[q];
  const pos = monthPos(cert.bill_date, q);
  const amounts: [number, number, number] = [0, 0, 0];
  amounts[pos] = cert.taxable_amount;

  const blankRow = (key: number) => (
    <tr key={key} style={{ height: '18px' }}>
      <td style={S.cell}></td>
      <td style={{ ...S.cell, textAlign: 'center' }}></td>
      <td style={{ ...S.cell, textAlign: 'right' }}></td>
      <td style={{ ...S.cell, textAlign: 'right' }}></td>
      <td style={{ ...S.cell, textAlign: 'right' }}></td>
      <td style={{ ...S.cell, textAlign: 'right' }}></td>
      <td style={{ ...S.cell, textAlign: 'right' }}></td>
    </tr>
  );

  return (
    <div>
      {/* ── Toolbar (screen only) ── */}
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
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Print / Save PDF</button>
          <Link href={`/dashboard/ap/bills/${cert.bill_id}`}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">View Bill</Link>
        </div>
      </div>
      {msg && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">{msg}</div>}

      {/* ════════════════════════════════════════════════
          BIR FORM 2307  –  January 2018 (ENCS)
          ════════════════════════════════════════════════ */}
      <div id="form2307" style={{
        width: '210mm', margin: '0 auto', backgroundColor: '#fff', color: '#000',
        fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8px',
        padding: '6mm 6mm 6mm 6mm', boxSizing: 'border-box',
      }}>

        {/* ── TOP HEADER ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1px' }}>
          <tbody>
            <tr>
              {/* For BIR Use Only box */}
              <td style={{ border: '1px solid black', padding: '2px 4px', width: '60px', verticalAlign: 'top', fontSize: '7px', lineHeight: '1.3' }}>
                <div>For BIR</div>
                <div>Use Only</div>
                <div style={{ marginTop: '4px' }}>BCS/</div>
                <div>Item:</div>
              </td>
              {/* Center: Gov header */}
              <td style={{ textAlign: 'center', verticalAlign: 'middle', padding: '2px' }}>
                <div style={{ fontSize: '8px' }}>Republic of the Philippines</div>
                <div style={{ fontSize: '9px', fontWeight: 700 }}>Department of Finance</div>
                <div style={{ fontSize: '9px', fontWeight: 700 }}>Bureau of Internal Revenue</div>
              </td>
              {/* Right: BIR Form No. */}
              <td style={{ border: '1px solid black', padding: '2px 6px', width: '120px', textAlign: 'right', verticalAlign: 'top' }}>
                <div style={{ fontSize: '7px' }}>BIR Form No.</div>
                <div style={{ fontSize: '36px', fontWeight: 900, lineHeight: '1', letterSpacing: '-1px' }}>2307</div>
                <div style={{ fontSize: '7px' }}>January 2018 (ENCS)</div>
                <div style={{ fontSize: '7px', marginTop: '2px' }}>2307 01/18ENCS</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── TITLE ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1px' }}>
          <tbody>
            <tr>
              <td style={{ border: '1px solid black', textAlign: 'center', padding: '4px', fontSize: '13px', fontWeight: 900 }}>
                Certificate of Creditable Tax Withheld at Source
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── INSTRUCTION ── */}
        <div style={{ fontSize: '7px', marginBottom: '2px' }}>
          Fill in all applicable spaces. Mark all appropriate boxes with an &ldquo;X&rdquo;.
        </div>

        {/* ── FIELD 1: For the Period ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0' }}>
          <tbody>
            <tr>
              <td style={S.num}>1</td>
              <td style={{ ...S.cell, padding: '3px 6px' }}>
                <span style={{ fontSize: '8px' }}>For the Period &nbsp;&nbsp;&nbsp;
                  <strong>From</strong>&nbsp;
                  <span style={{ display: 'inline-block', borderBottom: '1px solid black', minWidth: '80px', paddingBottom: '1px', fontSize: '8px' }}>{qFrom(y, q)}</span>
                  &nbsp;&nbsp;&nbsp;<strong>To</strong>&nbsp;
                  <span style={{ display: 'inline-block', borderBottom: '1px solid black', minWidth: '80px', paddingBottom: '1px', fontSize: '8px' }}>{qTo(y, q)}</span>
                  &nbsp;&nbsp;<span style={{ fontSize: '7px', color: '#555' }}>(MM/DD/YYYY)</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── PART I: PAYEE ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0' }}>
          <tbody>
            <tr>
              <td colSpan={2} style={S.hdr}>Part I – Payee Information</td>
            </tr>
            {/* Field 2: Payee TIN */}
            <tr>
              <td style={S.num}>2</td>
              <td style={{ ...S.cell, padding: '3px 6px' }}>
                <span style={S.label}>Taxpayer Identification Number <em>(TIN)</em></span>
                <span style={{ ...S.normal, fontFamily: 'monospace', letterSpacing: '2px', fontSize: '10px' }}>
                  {cert.supplier_tin
                    ? cert.supplier_tin
                    : <span style={{ color: '#aaa' }}>___  -  ___  -  ___  -  _____</span>}
                </span>
              </td>
            </tr>
            {/* Field 3: Payee Name */}
            <tr>
              <td style={S.num}>3</td>
              <td style={{ ...S.cell, padding: '3px 6px' }}>
                <span style={S.label}>Payee&apos;s Name <em>(Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)</em></span>
                <span style={S.value}>{cert.supplier_name}</span>
              </td>
            </tr>
            {/* Field 4: Payee Address + ZIP */}
            <tr>
              <td style={S.num}>4</td>
              <td style={{ ...S.cell, padding: '0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '3px 6px', width: '85%' }}>
                        <span style={S.label}>Registered Address</span>
                        <span style={S.normal}>{cert.supplier_address ?? ''}</span>
                      </td>
                      <td style={{ borderLeft: '1px solid black', padding: '3px 4px', width: '15%' }}>
                        <span style={S.label}>4A ZIP Code</span>
                        <span style={S.normal}></span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            {/* Field 5: Foreign Address */}
            <tr>
              <td style={S.num}>5</td>
              <td style={{ ...S.cell, padding: '3px 6px' }}>
                <span style={S.label}>Foreign Address, if applicable</span>
                <span style={S.normal}>&nbsp;</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── PART II: PAYOR ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0' }}>
          <tbody>
            <tr>
              <td colSpan={2} style={S.hdr}>Part II – Payor Information</td>
            </tr>
            {/* Field 6: Payor TIN */}
            <tr>
              <td style={S.num}>6</td>
              <td style={{ ...S.cell, padding: '3px 6px' }}>
                <span style={S.label}>Taxpayer Identification Number <em>(TIN)</em></span>
                <span style={{ ...S.normal, fontFamily: 'monospace', letterSpacing: '2px', fontSize: '10px' }}>
                  {cert.company_tin
                    ? cert.company_tin
                    : <span style={{ color: '#aaa' }}>___  -  ___  -  ___  -  _____</span>}
                </span>
              </td>
            </tr>
            {/* Field 7: Payor Name */}
            <tr>
              <td style={S.num}>7</td>
              <td style={{ ...S.cell, padding: '3px 6px' }}>
                <span style={S.label}>Payor&apos;s Name <em>(Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)</em></span>
                <span style={S.value}>{cert.company_name}</span>
              </td>
            </tr>
            {/* Field 8: Payor Address + ZIP */}
            <tr>
              <td style={S.num}>8</td>
              <td style={{ ...S.cell, padding: '0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '3px 6px', width: '85%' }}>
                        <span style={S.label}>Registered Address</span>
                        <span style={S.normal}>{cert.company_address ?? ''}</span>
                      </td>
                      <td style={{ borderLeft: '1px solid black', padding: '3px 4px', width: '15%' }}>
                        <span style={S.label}>8A ZIP Code</span>
                        <span style={S.normal}></span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── PART III: INCOME PAYMENTS TABLE ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0' }}>
          <thead>
            <tr>
              <td colSpan={7} style={S.hdr}>Part III – Details of Monthly Income Payments and Taxes Withheld</td>
            </tr>
            <tr>
              <th style={{ ...S.hdr, width: '32%', verticalAlign: 'middle' }} rowSpan={2}>
                Income Payments Subject to<br />Expanded Withholding Tax
              </th>
              <th style={{ ...S.hdr, width: '7%', verticalAlign: 'middle' }} rowSpan={2}>ATC</th>
              <th style={{ ...S.hdr }} colSpan={3}>AMOUNT OF INCOME PAYMENTS</th>
              <th style={{ ...S.hdr, width: '12%', verticalAlign: 'middle' }} rowSpan={2}>Total</th>
              <th style={{ ...S.hdr, width: '12%', verticalAlign: 'middle' }} rowSpan={2}>Tax Withheld for the Quarter</th>
            </tr>
            <tr>
              <th style={{ ...S.hdr, width: '12%' }}>
                1st Month of the<br />Quarter<br />
                <span style={{ fontWeight: 400, fontSize: '7px' }}>({months[0]})</span>
              </th>
              <th style={{ ...S.hdr, width: '12%' }}>
                2nd Month of the<br />Quarter<br />
                <span style={{ fontWeight: 400, fontSize: '7px' }}>({months[1]})</span>
              </th>
              <th style={{ ...S.hdr, width: '12%' }}>
                3rd Month of the<br />Quarter<br />
                <span style={{ fontWeight: 400, fontSize: '7px' }}>({months[2]})</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {/* ── Section A: EWT ── */}
            {/* Data row with actual values */}
            <tr style={{ height: '18px' }}>
              <td style={{ ...S.cell, fontSize: '8px' }}>
                {cert.atc_description ?? 'Income payment subject to expanded withholding tax'}
                <div style={{ fontSize: '7px', color: '#555' }}>({cert.internal_no} / {cert.bill_no} — {formatDate(cert.bill_date)})</div>
              </td>
              <td style={{ ...S.cell, textAlign: 'center', fontWeight: 700 }}>{cert.bir_atc_code}</td>
              <td style={{ ...S.cell, textAlign: 'right', fontFamily: 'monospace' }}>{amounts[0] > 0 ? fmt(amounts[0]) : ''}</td>
              <td style={{ ...S.cell, textAlign: 'right', fontFamily: 'monospace' }}>{amounts[1] > 0 ? fmt(amounts[1]) : ''}</td>
              <td style={{ ...S.cell, textAlign: 'right', fontFamily: 'monospace' }}>{amounts[2] > 0 ? fmt(amounts[2]) : ''}</td>
              <td style={{ ...S.cell, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(cert.taxable_amount)}</td>
              <td style={{ ...S.cell, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(cert.amount_withheld)}</td>
            </tr>
            {/* Empty rows (9 blank rows to match form) */}
            {[...Array(9)].map((_, i) => blankRow(i))}
            {/* Total row */}
            <tr style={{ backgroundColor: '#f0f0f0' }}>
              <td colSpan={2} style={{ ...S.cell, fontWeight: 700 }}>Total</td>
              <td style={{ ...S.cell, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{amounts[0] > 0 ? fmt(amounts[0]) : ''}</td>
              <td style={{ ...S.cell, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{amounts[1] > 0 ? fmt(amounts[1]) : ''}</td>
              <td style={{ ...S.cell, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{amounts[2] > 0 ? fmt(amounts[2]) : ''}</td>
              <td style={{ ...S.cell, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(cert.taxable_amount)}</td>
              <td style={{ ...S.cell, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(cert.amount_withheld)}</td>
            </tr>
            {/* ── Section B: Money Payments / Business Tax ── */}
            <tr>
              <td colSpan={7} style={{ ...S.cell, fontWeight: 700, fontSize: '8px', backgroundColor: '#e8e8e8' }}>
                Money Payments Subject to Withholding of Business Tax (Government &amp; Private)
              </td>
            </tr>
            {[...Array(8)].map((_, i) => blankRow(100 + i))}
            {/* Total row B */}
            <tr style={{ backgroundColor: '#f0f0f0' }}>
              <td colSpan={2} style={{ ...S.cell, fontWeight: 700 }}>Total</td>
              <td style={{ ...S.cell, textAlign: 'right' }}></td>
              <td style={{ ...S.cell, textAlign: 'right' }}></td>
              <td style={{ ...S.cell, textAlign: 'right' }}></td>
              <td style={{ ...S.cell, textAlign: 'right' }}></td>
              <td style={{ ...S.cell, textAlign: 'right' }}></td>
            </tr>
          </tbody>
        </table>

        {/* ── DECLARATION ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ border: '1px solid black', padding: '4px 6px', fontSize: '7px', lineHeight: '1.5' }}>
                We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and
                correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. Further, we give our consent to
                the processing of our information as contemplated under the *Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── SIGNATURES ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              {/* Left: Payor signature */}
              <td style={{ border: '1px solid black', padding: '4px 6px', width: '50%', verticalAlign: 'top' }}>
                <div style={{ minHeight: '32px' }}></div>
                <div style={{ borderTop: '1px solid black', paddingTop: '2px', fontSize: '7px', textAlign: 'center' }}>
                  Signature over Printed Name of Payor/Payor&apos;s Authorized Representative/Tax Agent
                </div>
                <div style={{ fontSize: '7px', textAlign: 'center', color: '#555', fontStyle: 'italic' }}>
                  (Indicate Title/Designation and TIN)
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px' }}>
                  <tbody>
                    <tr>
                      <td style={{ fontSize: '7px', width: '42%', verticalAlign: 'top', paddingRight: '4px' }}>
                        Tax Agent Accreditation No./<br />Attorney&apos;s Roll No. (if applicable)
                      </td>
                      <td style={{ fontSize: '7px', width: '29%', verticalAlign: 'top' }}>
                        <div>Date of Issue</div>
                        <div style={{ borderBottom: '1px solid black', minHeight: '12px' }}></div>
                        <div style={{ fontSize: '6px', color: '#555' }}>(MM/DD/YYYY)</div>
                      </td>
                      <td style={{ fontSize: '7px', width: '29%', verticalAlign: 'top', paddingLeft: '4px' }}>
                        <div>Date of Expiry</div>
                        <div style={{ borderBottom: '1px solid black', minHeight: '12px' }}></div>
                        <div style={{ fontSize: '6px', color: '#555' }}>(MM/DD/YYYY)</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              {/* Right: Payee/CONFORME */}
              <td style={{ border: '1px solid black', borderLeft: 'none', padding: '4px 6px', width: '50%', verticalAlign: 'top' }}>
                <div style={{ fontWeight: 700, fontSize: '8px', textAlign: 'center', marginBottom: '4px' }}>CONFORME:</div>
                <div style={{ minHeight: '32px' }}></div>
                <div style={{ borderTop: '1px solid black', paddingTop: '2px', fontSize: '7px', textAlign: 'center' }}>
                  Signature over Printed Name of Payee/Payee&apos;s Authorized Representative/Tax Agent
                </div>
                <div style={{ fontSize: '7px', textAlign: 'center', color: '#555', fontStyle: 'italic' }}>
                  (Indicate Title/Designation and TIN)
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px' }}>
                  <tbody>
                    <tr>
                      <td style={{ fontSize: '7px', width: '42%', verticalAlign: 'top', paddingRight: '4px' }}>
                        Tax Agent Accreditation No./<br />Attorney&apos;s Roll No. (if applicable)
                      </td>
                      <td style={{ fontSize: '7px', width: '29%', verticalAlign: 'top' }}>
                        <div>Date of Issue</div>
                        <div style={{ borderBottom: '1px solid black', minHeight: '12px' }}></div>
                        <div style={{ fontSize: '6px', color: '#555' }}>(MM/DD/YYYY)</div>
                      </td>
                      <td style={{ fontSize: '7px', width: '29%', verticalAlign: 'top', paddingLeft: '4px' }}>
                        <div>Date of Expiry</div>
                        <div style={{ borderBottom: '1px solid black', minHeight: '12px' }}></div>
                        <div style={{ fontSize: '6px', color: '#555' }}>(MM/DD/YYYY)</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── FOOTNOTE ── */}
        <div style={{ fontSize: '6.5px', marginTop: '3px' }}>
          *NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)
        </div>

        {/* Internal ref — screen only */}
        <div className="print:hidden" style={{ marginTop: '8px', borderTop: '1px solid #ddd', paddingTop: '6px', fontSize: '11px', color: '#666' }}>
          <strong style={{ color: '#333' }}>Certificate No.:</strong> {cert.cert_no} &nbsp;·&nbsp;
          <strong style={{ color: '#333' }}>Bill:</strong> {cert.internal_no} &nbsp;·&nbsp;
          <strong style={{ color: '#333' }}>Period:</strong> Q{q} {y} &nbsp;·&nbsp;
          <strong style={{ color: '#333' }}>Status:</strong> {cert.status}
          {cert.issued_at && <span> &nbsp;·&nbsp; <strong style={{ color: '#333' }}>Issued:</strong> {formatDate(cert.issued_at)}</span>}
        </div>
      </div>

      {/* ── Print CSS ── */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #form2307 { display: block !important; position: static !important; }
          #form2307 .print\\:hidden { display: none !important; }
          @page { size: A4; margin: 0; }
        }
      `}</style>
    </div>
  );
}
