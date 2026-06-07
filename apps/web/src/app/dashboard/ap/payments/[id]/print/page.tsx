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
  const billions = Math.floor(pesos / 1_000_000_000);
  const millions = Math.floor((pesos % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((pesos % 1_000_000) / 1_000);
  const remainder = pesos % 1_000;

  if (billions) parts.push(chunk(billions) + ' BILLION');
  if (millions) parts.push(chunk(millions) + ' MILLION');
  if (thousands) parts.push(chunk(thousands) + ' THOUSAND');
  if (remainder) parts.push(chunk(remainder));

  const pesoWord = parts.join(' ') || 'ZERO';
  return `${pesoWord} PESO${pesos !== 1 ? 'S' : ''} AND ${String(centavos).padStart(2, '0')}/100 ONLY`;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface Application {
  bill_id: string;
  internal_no: string;
  bill_no: string;
  bill_date: string;
  amount_applied: number;
}

interface Payment {
  id: string;
  voucher_no: string;
  payment_date: string;
  payment_method: string;
  reference: string | null;
  remarks: string | null;
  amount: number;
  status: string;
  supplier_name: string;
  supplier_address: string | null;
  je_id: string | null;
  branch_id: string | null;
  applications: Application[];
}

interface JELine {
  account_code: string;
  account_name: string;
  description: string;
  debit: number;
  credit: number;
}

interface Company {
  name: string;
  legal_name: string | null;
  tin: string | null;
  address: string | null;
  logo: string | null;
}

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

// ── Print Page ───────────────────────────────────────────────────────────────
export default function PrintVoucherPage() {
  const { id } = useParams<{ id: string }>();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [lines, setLines]     = useState<JELine[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;

    Promise.all([
      api.get<Payment>(`/ap/payments/${id}`),
      api.get<Company>(`/companies/${companyId}`),
    ]).then(async ([pmt, co]) => {
      setPayment(pmt);
      setCompany(co);

      // Fetch GL lines — from posted JE if available, else from preview
      if (pmt.je_id) {
        const je = await api.get<{ lines: JELine[] }>(`/gl/journal-entries/${pmt.je_id}`);
        setLines(je.lines.map(l => ({
          ...l,
          debit: Number(l.debit),
          credit: Number(l.credit),
        })));
      } else {
        const preview = await api.get<{ lines: JELine[] }>(`/ap/payments/${id}/journal-preview`).catch(() => ({ lines: [] }));
        setLines(preview.lines ?? []);
      }
    }).catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && payment) {
      setTimeout(() => window.print(), 300);
    }
  }, [loading, payment]);

  if (loading) return (
    <div className="flex h-screen items-center justify-center text-sm text-slate-500 print:hidden">
      Preparing voucher…
    </div>
  );
  if (error || !payment) return (
    <div className="flex h-screen items-center justify-center text-sm text-red-600 print:hidden">
      {error ?? 'Payment not found'}
    </div>
  );

  const particulars = payment.remarks
    || payment.applications.map(a => `Payment for ${a.internal_no}${a.bill_no ? ` (${a.bill_no})` : ''}`).join('; ')
    || `Payment to ${payment.supplier_name}`;

  return (
    <>
      {/* Screen-only toolbar */}
      <div className="mb-4 flex gap-2 print:hidden">
        <button
          onClick={() => window.print()}
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Print
        </button>
        <button
          onClick={() => window.close()}
          className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      {/* ── Voucher ─────────────────────────────────────────────────────── */}
      <div className="voucher mx-auto bg-white text-black" style={{ width: '215mm', minHeight: '279mm', fontFamily: 'Arial, sans-serif', fontSize: '10pt', padding: '10mm 12mm' }}>

        {/* Top: logo + company info | date */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4mm' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            {company?.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo} alt="logo" style={{ height: '52px', width: 'auto', objectFit: 'contain' }} />
            )}
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '12pt', lineHeight: 1.2 }}>
                {company?.legal_name || company?.name}
              </div>
              {company?.address && (
                <div style={{ fontSize: '8pt', color: '#444', maxWidth: '120mm', lineHeight: 1.4 }}>
                  {company.address}
                </div>
              )}
              {company?.tin && (
                <div style={{ fontSize: '8pt', color: '#444' }}>VAT Reg. TIN: {company.tin}</div>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '10pt' }}>
              <tbody>
                <tr>
                  <td style={{ paddingRight: '4px' }}>Date</td>
                  <td style={{ borderBottom: '1px solid black', minWidth: '30mm', paddingLeft: '4px' }}>
                    {fmtDate(payment.payment_date)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Payee + amount row */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '2mm', borderBottom: '1px solid black', paddingBottom: '1mm' }}>
          <span style={{ whiteSpace: 'nowrap' }}>Payee</span>
          <span style={{ flex: 1, borderBottom: '1px solid black', fontWeight: 'bold', textAlign: 'center', letterSpacing: '1px' }}>
            ***{payment.supplier_name.toUpperCase()}***
          </span>
          <span style={{ whiteSpace: 'nowrap', marginLeft: '4px' }}>(₱</span>
          <span style={{ borderBottom: '1px solid black', minWidth: '32mm', fontWeight: 'bold', textAlign: 'center' }}>
            ****{fmt(payment.amount)}***
          </span>
          <span>)</span>
        </div>

        {/* Amount in words */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '4mm' }}>
          <span style={{ whiteSpace: 'nowrap' }}>Amount in words</span>
          <span style={{ flex: 1, borderBottom: '1px solid black', fontWeight: 'bold', paddingLeft: '4px' }}>
            ***{amountToWords(payment.amount)}***
          </span>
        </div>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: '2mm' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span style={{ fontSize: '14pt', fontWeight: 'bold', letterSpacing: '2px' }}>CHECK VOUCHER</span>
            <span style={{ fontSize: '12pt' }}>
              N<sup>o</sup>&nbsp;
              <span style={{ color: '#c00', fontWeight: 'bold', fontSize: '14pt' }}>{payment.voucher_no}</span>
            </span>
          </div>
        </div>

        {/* Particulars / Amount table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4mm', border: '1.5px solid black' }}>
          <thead>
            <tr style={{ backgroundColor: '#f0f0f0' }}>
              <th style={{ border: '1px solid black', padding: '3px 6px', textAlign: 'center', fontWeight: 'bold', width: '75%' }}>PARTICULARS</th>
              <th style={{ border: '1px solid black', padding: '3px 6px', textAlign: 'center', fontWeight: 'bold', width: '25%' }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ border: '1px solid black', padding: '4px 6px', verticalAlign: 'top', minHeight: '20mm' }}>
                <div>dated {fmtDate(payment.payment_date)}</div>
                <div style={{ marginTop: '2px' }}>{particulars}</div>
              </td>
              <td style={{ border: '1px solid black', padding: '4px 6px', verticalAlign: 'top', textAlign: 'right' }}>
                PHP{fmt(payment.amount)}
              </td>
            </tr>
            {/* blank rows for space */}
            {[0, 1, 2, 3].map(i => (
              <tr key={i}>
                <td style={{ border: '1px solid black', padding: '0', height: '7mm' }}>&nbsp;</td>
                <td style={{ border: '1px solid black', padding: '0' }}>&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* GL Account lines */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm', border: '1.5px solid black' }}>
          <thead>
            <tr style={{ backgroundColor: '#f0f0f0' }}>
              <th style={{ border: '1px solid black', padding: '3px 6px', textAlign: 'center', fontWeight: 'bold', width: '12%' }}>ACCOUNT NO.</th>
              <th style={{ border: '1px solid black', padding: '3px 6px', textAlign: 'center', fontWeight: 'bold', width: '52%' }}>ACCOUNT NAME</th>
              <th style={{ border: '1px solid black', padding: '3px 6px', textAlign: 'center', fontWeight: 'bold', width: '18%' }}>DEBIT</th>
              <th style={{ border: '1px solid black', padding: '3px 6px', textAlign: 'center', fontWeight: 'bold', width: '18%' }}>CREDIT</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ border: '1px solid black', padding: '3px 6px', textAlign: 'center' }}>{l.account_code}</td>
                <td style={{ border: '1px solid black', padding: '3px 6px' }}>{l.account_name}</td>
                <td style={{ border: '1px solid black', padding: '3px 6px', textAlign: 'right' }}>
                  {l.debit > 0 ? fmt(l.debit) : ''}
                </td>
                <td style={{ border: '1px solid black', padding: '3px 6px', textAlign: 'right' }}>
                  {l.credit > 0 ? fmt(l.credit) : ''}
                </td>
              </tr>
            ))}
            {/* blank fill rows */}
            {Array.from({ length: Math.max(0, 5 - lines.length) }).map((_, i) => (
              <tr key={`blank-${i}`}>
                <td style={{ border: '1px solid black', padding: '0', height: '7mm' }}>&nbsp;</td>
                <td style={{ border: '1px solid black' }}>&nbsp;</td>
                <td style={{ border: '1px solid black' }}>&nbsp;</td>
                <td style={{ border: '1px solid black' }}>&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Signatures */}
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid black' }}>
          <tbody>
            <tr>
              <td style={{ border: '1px solid black', padding: '3px 6px', width: '25%' }}>
                <div style={{ fontWeight: 'bold', fontSize: '9pt' }}>PREPARED BY:</div>
                <div style={{ borderTop: '1px solid black', marginTop: '8mm', paddingTop: '2px', fontSize: '9pt', textAlign: 'center' }}>&nbsp;</div>
              </td>
              <td style={{ border: '1px solid black', padding: '3px 6px', width: '25%' }}>
                <div style={{ fontWeight: 'bold', fontSize: '9pt' }}>VERIFIED BY:</div>
                <div style={{ borderTop: '1px solid black', marginTop: '8mm', paddingTop: '2px', fontSize: '9pt', textAlign: 'center' }}>&nbsp;</div>
              </td>
              <td style={{ border: '1px solid black', padding: '3px 6px', width: '50%' }}>
                <div style={{ fontWeight: 'bold', fontSize: '9pt' }}>APPROVED BY:</div>
                <div style={{ borderTop: '1px solid black', marginTop: '8mm', paddingTop: '2px', fontSize: '9pt', textAlign: 'center' }}>&nbsp;</div>
              </td>
            </tr>
            <tr>
              <td colSpan={2} style={{ border: '1px solid black', padding: '3px 6px' }}>
                <div style={{ fontWeight: 'bold', fontSize: '9pt' }}>CHECK NO.</div>
                <div style={{ borderBottom: '1px solid black', minHeight: '8mm' }}>&nbsp;</div>
              </td>
              <td style={{ border: '1px solid black', padding: '3px 6px' }}>
                <div style={{ fontWeight: 'bold', fontSize: '9pt' }}>RECEIVED BY:</div>
                <div style={{ height: '8mm' }}>&nbsp;</div>
              </td>
            </tr>
            <tr>
              <td colSpan={3} style={{ border: '1px solid black', padding: '3px 6px', textAlign: 'right' }}>
                <div style={{ fontWeight: 'bold', fontSize: '9pt', marginBottom: '6mm' }}>SIGNATURE OVER PRINTED NAME</div>
                <div style={{ borderTop: '1px solid black', maxWidth: '80mm', marginLeft: 'auto' }}>&nbsp;</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .voucher, .voucher * { visibility: visible; }
          .voucher { position: fixed; top: 0; left: 0; width: 100%; }
          @page { size: Letter; margin: 0; }
        }
      `}</style>
    </>
  );
}
