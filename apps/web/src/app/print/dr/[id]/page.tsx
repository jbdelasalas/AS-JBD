'use client';
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface DRLine {
  id: string; line_no: number;
  item_id: string; item_name: string | null; item_uom: string | null;
  description: string; qty_delivered: number;
  so_unit_price: number | null; so_discount_pct: number | null;
}
interface DR {
  id: string; dr_no: string; delivery_date: string;
  customer_id: string; customer_name: string; payment_terms_days: number;
  tally_sheet_id: string | null;
  lines: DRLine[];
}
interface Company {
  id: string; name: string; legal_name: string | null;
  tin: string | null; address: string | null; logo: string | null;
}
interface Customer { id: string; name: string; address: string | null; }
interface TallyLine { item_id: string | null; heads: number; net_kgs: number; }
interface TallySheet { id: string; lines: TallyLine[]; }

const MIN_ROWS = 20;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}
function fmtNum(n: number, dec = 2): string {
  return n.toLocaleString('en-PH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function DRPrintPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [dr, setDr]           = useState<DR | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tally, setTally]     = useState<TallySheet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id') ?? '';
    api.get<DR>(`/sales/delivery-receipts/${id}`)
      .then(async d => {
        setDr(d);
        const [comp, cust] = await Promise.all([
          companyId ? api.get<Company>(`/companies/${companyId}`).catch(() => null) : Promise.resolve(null),
          api.get<Customer>(`/ar/customers/${d.customer_id}`).catch(() => null),
        ]);
        setCompany(comp);
        setCustomer(cust);
        if (d.tally_sheet_id) {
          api.get<TallySheet>(`/poultry/tally-sheets/${d.tally_sheet_id}`)
            .then(t => setTally(t)).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ textAlign: 'center', padding: '4rem', fontFamily: 'Arial' }}>Loading…</div>;
  if (!dr)     return <div style={{ textAlign: 'center', padding: '4rem', fontFamily: 'Arial', color: '#c00' }}>Delivery receipt not found.</div>;

  // Build heads lookup from tally lines (item_id → total heads)
  const headsMap = new Map<string, number>();
  if (tally?.lines) {
    for (const tl of tally.lines) {
      if (tl.item_id) headsMap.set(tl.item_id, (headsMap.get(tl.item_id) ?? 0) + Number(tl.heads ?? 0));
    }
  }

  const lines       = dr.lines;
  const totalKgs    = lines.reduce((s, l) => s + Number(l.qty_delivered), 0);
  const totalHeads  = lines.reduce((s, l) => s + (headsMap.get(l.item_id) ?? 0), 0);
  const totalAmount = lines.reduce((s, l) => s + Number(l.qty_delivered) * Number(l.so_unit_price ?? 0) * (1 - Number(l.so_discount_pct ?? 0) / 100), 0);
  const blankRows   = Math.max(0, MIN_ROWS - lines.length);
  const termsLabel  = dr.payment_terms_days ? `Net ${dr.payment_terms_days}` : '';

  const companyName = company?.legal_name ?? company?.name ?? '';

  return (
    <>
      {/* Screen-only controls */}
      <div className="print:hidden flex gap-3 p-4 border-b border-slate-200 bg-white">
        <button onClick={() => window.print()}
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Print / Save PDF
        </button>
        <button onClick={() => router.back()}
          className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          ← Back
        </button>
        <span className="ml-auto self-center text-xs text-slate-400">
          Use browser Print → Save as PDF for best results
        </span>
      </div>

      {/* Print area */}
      <div id="print-area" style={{
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '9pt',
        color: '#000',
        background: '#fff',
        width: '210mm',
        margin: '0 auto',
        padding: '10mm 12mm',
        boxSizing: 'border-box',
      }}>

        {/* ── Company header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8pt' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8pt' }}>
            {company?.logo
              ? <img src={company.logo} alt="Logo" style={{ width: '44pt', height: '44pt', objectFit: 'contain' }} />
              : <div style={{ width: '44pt', height: '44pt', border: '1px solid #bbb', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '5pt', color: '#bbb', flexShrink: 0 }}>LOGO</div>
            }
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '12pt', letterSpacing: '0.5pt' }}>{companyName}</div>
              <div style={{ fontSize: '7pt', color: '#555', marginTop: '1pt' }}>{company?.address ?? ''}</div>
              {company?.tin && (
                <div style={{ fontSize: '7pt', color: '#555' }}>VAT Reg TIN: {company.tin}</div>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 'bold', fontSize: '13pt', letterSpacing: '2pt', textDecoration: 'underline' }}>
              DELIVERY RECEIPT
            </div>
            <div style={{ fontSize: '10pt', marginTop: '2pt' }}>
              N° <span style={{ fontWeight: 'bold', fontSize: '13pt' }}>{dr.dr_no}</span>
            </div>
          </div>
        </div>

        {/* ── Info fields ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8pt', fontSize: '9pt' }}>
          <tbody>
            <tr>
              <td style={{ fontWeight: 'bold', whiteSpace: 'nowrap', padding: '2pt 4pt 2pt 0', width: '28%' }}>DELIVERED TO:</td>
              <td style={{ borderBottom: '1px solid #000', padding: '2pt 4pt', width: '38%', color: '#0050b3' }}>
                {dr.customer_name}
              </td>
              <td style={{ fontWeight: 'bold', whiteSpace: 'nowrap', padding: '2pt 0 2pt 12pt', width: '10%' }}>DATE:</td>
              <td style={{ borderBottom: '1px solid #000', padding: '2pt 4pt', width: '24%' }}>
                {fmtDate(dr.delivery_date)}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 'bold', padding: '2pt 4pt 2pt 0' }}>ADDRESS:</td>
              <td style={{ borderBottom: '1px solid #000', padding: '2pt 4pt' }}>
                {customer?.address ?? ''}
              </td>
              <td style={{ fontWeight: 'bold', padding: '2pt 0 2pt 12pt' }}>TERMS:</td>
              <td style={{ borderBottom: '1px solid #000', padding: '2pt 4pt' }}>{termsLabel}</td>
            </tr>
          </tbody>
        </table>

        {/* ── Lines table ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', marginBottom: '8pt' }}>
          <thead>
            <tr style={{ background: '#000', color: '#fff' }}>
              <th style={thStyle('center', '60pt')}>HEADS/PIECES</th>
              <th style={thStyle('center', '72pt')}>KILOGRAMS</th>
              <th style={thStyle('left')}>PRODUCTS DESCRIPTION</th>
              <th style={thStyle('right', '60pt')}>PRICE</th>
              <th style={thStyle('right', '80pt')}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const heads   = headsMap.get(l.item_id);
              const discPct = Number(l.so_discount_pct ?? 0);
              const amount  = Number(l.qty_delivered) * Number(l.so_unit_price ?? 0) * (1 - discPct / 100);
              return (
                <tr key={l.id} style={{ borderBottom: '1px solid #ccc' }}>
                  <td style={tdStyle('center')}>{heads ? fmtNum(heads, 0) : ''}</td>
                  <td style={tdStyle('center')}>{fmtNum(Number(l.qty_delivered), 3)}</td>
                  <td style={tdStyle('left')}>{l.item_name ?? l.description}</td>
                  <td style={tdStyle('right')}>{l.so_unit_price != null ? fmtNum(Number(l.so_unit_price)) : ''}</td>
                  <td style={tdStyle('right')}>{l.so_unit_price != null ? fmtNum(amount) : ''}</td>
                </tr>
              );
            })}
            {Array.from({ length: blankRows }).map((_, i) => (
              <tr key={`b${i}`} style={{ borderBottom: '1px solid #ccc' }}>
                <td style={tdStyle('center')}>&nbsp;</td>
                <td style={tdStyle('center')}>&nbsp;</td>
                <td style={tdStyle('left')}>&nbsp;</td>
                <td style={tdStyle('right')}>&nbsp;</td>
                <td style={tdStyle('right')}>&nbsp;</td>
              </tr>
            ))}
            {/* Totals */}
            <tr style={{ borderTop: '2px solid #000', background: '#f0f0f0', fontWeight: 'bold' }}>
              <td style={{ ...tdStyle('center'), fontWeight: 'bold' }}>
                {totalHeads > 0 ? fmtNum(totalHeads, 0) : ''}
              </td>
              <td style={{ ...tdStyle('center'), fontWeight: 'bold' }}>{fmtNum(totalKgs, 3)}</td>
              <td style={{ ...tdStyle('center'), fontWeight: 'bold', letterSpacing: '2pt' }}>TOTAL</td>
              <td style={tdStyle('right')}></td>
              <td style={{ ...tdStyle('right'), fontWeight: 'bold' }}>{fmtNum(totalAmount)}</td>
            </tr>
          </tbody>
        </table>

        {/* ── Received text ── */}
        <div style={{ textAlign: 'center', fontSize: '8pt', fontStyle: 'italic', marginBottom: '14pt' }}>
          RECEIVED THE ABOVE MERCHANDISE IN GOOD ORDER AND CONDITION.
        </div>

        {/* ── Signatures ── */}
        <div style={{ fontWeight: 'bold', fontSize: '8pt', marginBottom: '20pt' }}>
          CHECKED AND CERTIFIED BY:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20pt' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid #000', paddingTop: '3pt', fontSize: '8pt', fontWeight: 'bold' }}>
              COMPANY REPRESENTATIVE
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid #000', paddingTop: '3pt', fontSize: '8pt', fontWeight: 'bold' }}>
              CUSTOMER REPRESENTATIVE
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { margin: 0; background: #fff; }
          #print-area { width: 100% !important; margin: 0 !important; padding: 10mm 12mm !important; box-shadow: none !important; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>
    </>
  );
}

function thStyle(align: 'left' | 'center' | 'right', width?: string): React.CSSProperties {
  return {
    border: '1px solid #000',
    padding: '3pt 4pt',
    textAlign: align,
    fontWeight: 'bold',
    width,
    whiteSpace: 'nowrap',
  };
}

function tdStyle(align: 'left' | 'center' | 'right'): React.CSSProperties {
  return {
    border: '1px solid #ccc',
    padding: '2pt 4pt',
    textAlign: align,
    height: '16pt',
    fontFamily: align === 'right' || align === 'center' ? 'monospace' : undefined,
    whiteSpace: 'nowrap',
  };
}
