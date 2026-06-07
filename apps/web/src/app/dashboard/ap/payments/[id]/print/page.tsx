'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

// ── Amount to words ──────────────────────────────────────────────────────────
const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
  'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
  'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function chunk(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  return ONES[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + chunk(n % 100) : '');
}

function amountToWords(amount: number): string {
  const total = Math.round(amount * 100);
  const pesos = Math.floor(total / 100);
  const centavos = total % 100;
  if (pesos === 0 && centavos === 0) return 'ZERO PESOS AND 00/100 ONLY';
  const parts: string[] = [];
  if (Math.floor(pesos / 1_000_000_000)) parts.push(chunk(Math.floor(pesos / 1_000_000_000)) + ' BILLION');
  if (Math.floor((pesos % 1_000_000_000) / 1_000_000)) parts.push(chunk(Math.floor((pesos % 1_000_000_000) / 1_000_000)) + ' MILLION');
  if (Math.floor((pesos % 1_000_000) / 1_000)) parts.push(chunk(Math.floor((pesos % 1_000_000) / 1_000)) + ' THOUSAND');
  if (pesos % 1_000) parts.push(chunk(pesos % 1_000));
  return `${parts.join(' ') || 'ZERO'} PESO${pesos !== 1 ? 'S' : ''} AND ${String(centavos).padStart(2, '0')}/100 ONLY`;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface Application { bill_id: string; internal_no: string; bill_no: string; bill_date: string; amount_applied: number; }
interface Payment {
  id: string; voucher_no: string; payment_date: string; payment_method: string;
  reference: string | null; remarks: string | null; amount: number; status: string;
  supplier_name: string; supplier_address: string | null; je_id: string | null;
  applications: Application[];
}
interface JELine { account_code: string; account_name: string; description: string; debit: number; credit: number; }
interface Company { name: string; legal_name: string | null; tin: string | null; address: string | null; logo: string | null; }

function n2(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string) {
  const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

// ── Shared border/cell styles ─────────────────────────────────────────────────
const B = '1px solid #000';
const cell = (extra?: React.CSSProperties): React.CSSProperties => ({ border: B, padding: '3px 5px', ...extra });
const th = (extra?: React.CSSProperties): React.CSSProperties => ({ border: B, padding: '3px 5px', fontWeight: 'bold', textAlign: 'center', backgroundColor: '#f2f2f2', ...extra });

// ── Print Page ───────────────────────────────────────────────────────────────
export default function PrintVoucherPage() {
  const { id } = useParams<{ id: string }>();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [lines, setLines] = useState<JELine[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<Payment>(`/ap/payments/${id}`),
      api.get<Company>(`/companies/${companyId}`),
    ]).then(async ([pmt, co]) => {
      setPayment(pmt);
      setCompany(co);
      if (pmt.je_id) {
        const je = await api.get<{ lines: JELine[] }>(`/gl/journal-entries/${pmt.je_id}`);
        setLines(je.lines.map(l => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })));
      } else {
        const preview = await api.get<{ lines: JELine[] }>(`/ap/payments/${id}/journal-preview`).catch(() => ({ lines: [] }));
        setLines(preview.lines ?? []);
      }
    }).catch(e => setError((e as Error).message)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { if (!loading && payment) setTimeout(() => window.print(), 400); }, [loading, payment]);

  if (loading) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: '#666' }}>Preparing voucher…</div>;
  if (error || !payment) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: '#c00' }}>{error ?? 'Payment not found'}</div>;

  const particulars = payment.remarks
    || payment.applications.map(a => `Payment for ${a.internal_no}${a.bill_no ? ` (${a.bill_no})` : ''}`).join('; ')
    || `Payment to ${payment.supplier_name}`;


  return (
    <>
      {/* ── Screen toolbar ── */}
      <div className="print:hidden" style={{ padding: '12px 16px', display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
        <button onClick={() => window.print()} style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 16px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 }}>Print</button>
        <button onClick={() => window.close()} style={{ background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '4px', padding: '6px 16px', fontSize: '13px', cursor: 'pointer' }}>Close</button>
      </div>

      {/* ── Voucher ── */}
      <div className="voucher" style={{ width: '210mm', margin: '0 auto', padding: '8mm 10mm 10mm', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '10pt', color: '#000', background: '#fff', boxSizing: 'border-box' }}>

        {/* ─── CHECK STUB TOP ─────────────────────────────────────── */}

        {/* Row 1: Date — right aligned */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '3mm', alignItems: 'baseline', gap: '4px' }}>
          <span>Date</span>
          <span style={{ display: 'inline-block', borderBottom: B, minWidth: '38mm', paddingLeft: '4px', paddingRight: '4px', textAlign: 'center' }}>
            {fmtDate(payment.payment_date)}
          </span>
        </div>

        {/* Row 2: Payee + amount */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '2mm' }}>
          <span style={{ whiteSpace: 'nowrap', fontWeight: 'normal' }}>Payee</span>
          <span style={{ display: 'inline-block', flex: 1, borderBottom: B, textAlign: 'left', fontWeight: 'bold', letterSpacing: '0.5px', paddingLeft: '4px' }}>
            ***{payment.supplier_name.toUpperCase()}***
          </span>
          <span style={{ whiteSpace: 'nowrap' }}>&nbsp;(P</span>
          <span style={{ display: 'inline-block', borderBottom: B, minWidth: '36mm', textAlign: 'center', fontWeight: 'bold' }}>
            ****{n2(payment.amount)}***
          </span>
          <span>)</span>
        </div>

        {/* Row 3: Amount in words */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '4mm' }}>
          <span style={{ whiteSpace: 'nowrap' }}>Amount in words</span>
          <span style={{ display: 'inline-block', flex: 1, borderBottom: B, textAlign: 'left', fontWeight: 'bold', letterSpacing: '0.5px', paddingLeft: '4px' }}>
            ***{amountToWords(payment.amount)}***
          </span>
        </div>

        {/* Row 4: Company info (left) + signatory lines (right) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '3mm' }}>
          {/* Company logo + info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {company?.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo} alt="logo" style={{ height: '56px', width: 'auto', objectFit: 'contain' }} />
            )}
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '13pt', lineHeight: 1.1, textTransform: 'uppercase' }}>
                {company?.legal_name || company?.name || ''}
              </div>
              {company?.address && (
                <div style={{ fontSize: '8pt', color: '#333', lineHeight: 1.4, maxWidth: '110mm' }}>
                  {company.address}
                </div>
              )}
              {company?.tin && (
                <div style={{ fontSize: '8pt', color: '#333' }}>VAT Reg. TIN:{company.tin}</div>
              )}
            </div>
          </div>
          {/* Signatory lines */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8mm', minWidth: '55mm', paddingBottom: '2mm' }}>
            <div style={{ borderBottom: B }}>&nbsp;</div>
            <div style={{ borderBottom: B }}>&nbsp;</div>
          </div>
        </div>

        <div style={{ marginBottom: '3mm' }} />

        {/* ─── VOUCHER BODY ────────────────────────────────────────── */}

        {/* Title row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2mm' }}>
          <span style={{ fontSize: '14pt', fontWeight: 'bold', letterSpacing: '3px' }}>CHECK VOUCHER</span>
          <span style={{ fontSize: '11pt' }}>
            N<sup style={{ fontSize: '8pt' }}>o</sup>&nbsp;
            <span style={{ color: '#cc0000', fontWeight: 'bold', fontSize: '15pt' }}>{payment.voucher_no}</span>
          </span>
        </div>

        {/* ── Particulars table ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '3mm', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '76%' }} />
            <col style={{ width: '24%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={th()}>PARTICULARS</th>
              <th style={th()}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell({ verticalAlign: 'top', lineHeight: 1.4 })}>
                <div>dated {fmtDate(payment.payment_date)}</div>
                <div>{particulars}</div>
              </td>
              <td style={cell({ verticalAlign: 'top', textAlign: 'right' })}>
                PHP{n2(payment.amount)}
              </td>
            </tr>
            {/* tall filler row */}
            <tr>
              <td style={cell({ height: '35mm' })}>&nbsp;</td>
              <td style={cell()}>&nbsp;</td>
            </tr>
          </tbody>
        </table>

        {/* ── GL Accounts table — data rows + tall filler + PREPARED/VERIFIED/APPROVED at bottom ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '48%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={th({ whiteSpace: 'nowrap' })}>ACCOUNT NO.</th>
              <th style={th()}>ACCOUNT NAME</th>
              <th style={th()}>DEBIT</th>
              <th style={th()}>CREDIT</th>
            </tr>
          </thead>
          <tbody>
            {/* Data rows */}
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={cell({ textAlign: 'center' })}>{l.account_code}</td>
                <td style={cell()}>{l.account_name}</td>
                <td style={cell({ textAlign: 'right' })}>{l.debit > 0 ? n2(l.debit) : ''}</td>
                <td style={cell({ textAlign: 'right' })}>{l.credit > 0 ? n2(l.credit) : ''}</td>
              </tr>
            ))}
            {/* Single tall filler row — extends box downward */}
            <tr>
              <td style={cell({ height: '55mm', verticalAlign: 'top' })}>&nbsp;</td>
              <td style={cell({ verticalAlign: 'top' })}>&nbsp;</td>
              <td style={cell({ verticalAlign: 'top' })}>&nbsp;</td>
              <td style={cell({ verticalAlign: 'top' })}>&nbsp;</td>
            </tr>
            {/* PREPARED BY | VERIFIED BY | APPROVED BY — bottom row inside the GL border */}
            <tr>
              <td colSpan={4} style={{ border: B, padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '33.33%' }} />
                    <col style={{ width: '33.33%' }} />
                    <col style={{ width: '33.34%' }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <td style={{ borderRight: B, padding: '4px 6px', verticalAlign: 'top' }}>
                        <div style={{ fontSize: '9pt', fontWeight: 'bold' }}>PREPARED BY:</div>
                        <div style={{ marginTop: '9mm', borderTop: B, paddingTop: '2px', minHeight: '5mm' }}>&nbsp;</div>
                      </td>
                      <td style={{ borderRight: B, padding: '4px 6px', verticalAlign: 'top' }}>
                        <div style={{ fontSize: '9pt', fontWeight: 'bold' }}>VERIFIED BY:</div>
                        <div style={{ marginTop: '9mm', borderTop: B, paddingTop: '2px', minHeight: '5mm' }}>&nbsp;</div>
                      </td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                        <div style={{ fontSize: '9pt', fontWeight: 'bold' }}>APPROVED BY:</div>
                        <div style={{ marginTop: '9mm', borderTop: B, paddingTop: '2px', minHeight: '5mm' }}>&nbsp;</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── CHECK NO. + RECEIVED BY — outside the bordered table ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '4mm', gap: '8mm' }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '9pt', fontWeight: 'bold' }}>CHECK NO.</span>
            <div style={{ borderBottom: B, marginTop: '6mm', width: '50mm' }}>&nbsp;</div>
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '9pt', fontWeight: 'bold' }}>RECEIVED BY:</span>
          </div>
        </div>

        {/* ── SIGNATURE OVER PRINTED NAME ── */}
        <div style={{ textAlign: 'center', marginTop: '6mm' }}>
          <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '6mm' }}>SIGNATURE OVER PRINTED NAME</div>
          <div style={{ borderTop: B, width: '70mm', margin: '0 auto' }}>&nbsp;</div>
        </div>

      </div>

      <style>{`
        @media print {
          body > *:not(.voucher-root) { display: none !important; }
          .print\\:hidden { display: none !important; }
          .voucher {
            position: fixed !important;
            top: 0 !important; left: 0 !important;
            width: 210mm !important;
            margin: 0 !important;
            padding: 8mm 10mm 10mm !important;
          }
          @page { size: Letter portrait; margin: 0; }
        }
      `}</style>
    </>
  );
}
