'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface POLine {
  id: string;
  line_no: number;
  item_id: string | null;
  gl_account_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  line_total: number;
  item_sku: string | null;
  item_name: string | null;
  item_uom: string | null;
  gl_account_code: string | null;
}

interface PO {
  id: string;
  po_no: string;
  po_date: string;
  expected_date: string | null;
  remarks: string | null;
  supplier_name: string;
  supplier_code: string;
  supplier_address: string | null;
  supplier_tin: string | null;
  subtotal: number;
  vat_amount: number;
  total: number;
  status: string;
  created_by_name: string | null;
  approved_by_name: string | null;
  lines: POLine[];
}

interface Company {
  id: string;
  name: string;
  legal_name: string | null;
  tin: string | null;
  address: string | null;
  phone: string | null;
  logo: string | null;
}


function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function fmtNum(n: number, dec = 2): string {
  return n.toLocaleString('en-PH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function POPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [po, setPo] = useState<PO | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id') ?? '';
    Promise.all([
      api.get<PO>(`/purchasing/purchase-orders/${id}`),
      companyId ? api.get<Company>(`/companies/${companyId}`) : Promise.resolve(null),
    ]).then(([p, c]) => {
      setPo(p);
      setCompany(c);
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && po) {
      setTimeout(() => window.print(), 400);
    }
  }, [loading, po]);

  if (loading) {
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', textAlign: 'center', paddingTop: '4rem', color: '#555' }}>
        Loading…
      </div>
    );
  }
  if (!po) {
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', textAlign: 'center', paddingTop: '4rem', color: '#c00' }}>
        Purchase order not found.
      </div>
    );
  }

  const BK = '1px solid #000';
  const companyName = company?.name ?? 'ART FRESH CHICKEN CORP';
  const companyAddress = company?.address ?? '';
  const companyPhone = company?.phone ?? '';
  const companyLogo = company?.logo ?? null;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #fff !important; color: #000 !important; color-scheme: light !important; }
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          .no-print { display: none !important; }
          #po-print {
            width: 210mm !important;
            min-height: 264mm;
            padding: 18mm 15mm 15mm 15mm !important;
            margin: 0 !important;
            box-shadow: none !important;
            display: flex !important;
            flex-direction: column !important;
          }
        }
        @media screen {
          body { background: #e0e0e0 !important; }
          #po-print { margin: 24px auto; box-shadow: 0 2px 12px rgba(0,0,0,0.15); }
        }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="no-print" style={{
        background: '#1e3a5f', color: '#fff', padding: '10px 20px',
        display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px',
      }}>
        <button
          onClick={() => window.print()}
          style={{
            background: '#fff', color: '#1e3a5f', border: 'none', borderRadius: '4px',
            padding: '6px 16px', fontWeight: 700, cursor: 'pointer', fontSize: '13px',
          }}
        >
          Print / Save PDF
        </button>
        <button
          onClick={() => window.close()}
          style={{
            background: 'transparent', color: '#ccc', border: '1px solid #ccc',
            borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px',
          }}
        >
          Close
        </button>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{po.po_no}</span>
      </div>

      {/* Print document */}
      <div id="po-print" style={{
        width: '210mm',
        minHeight: '264mm',
        background: '#fff',
        fontFamily: 'var(--font-outfit), Arial, sans-serif',
        fontSize: '13px',
        color: '#000',
        padding: '8mm 10mm',
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* ── MAIN CONTENT ── */}
        <div>

        {/* ── HEADER ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
          <tbody>
            <tr>
              {/* Logo + Company info */}
              <td style={{ verticalAlign: 'middle', width: '60%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {companyLogo && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={companyLogo}
                      alt="Company Logo"
                      style={{
                        width: '70px',
                        height: '70px',
                        objectFit: 'contain',
                        flexShrink: 0,
                        backgroundColor: '#fff',
                        mixBlendMode: 'multiply',
                      }}
                    />
                  )}
                  <div>
                    <div style={{ fontSize: '23px', fontWeight: 900, lineHeight: 1.1, letterSpacing: '0.5px' }}>
                      {companyName}
                    </div>
                    {companyAddress && (
                      <div style={{ fontSize: '12px', color: '#333', marginTop: '2px' }}>{companyAddress}</div>
                    )}
                    {companyPhone && (
                      <div style={{ fontSize: '12px', color: '#333' }}>Tel No. {companyPhone}</div>
                    )}
                  </div>
                </div>
              </td>
              {/* PO Number */}
              <td style={{ textAlign: 'right', verticalAlign: 'top' }}>
                <div style={{ fontSize: '14px', fontWeight: 700 }}>PO No.&nbsp;&nbsp;{po.po_no}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── TITLE ── */}
        <div style={{
          textAlign: 'center', fontSize: '16px', fontWeight: 900,
          padding: '10px 0', marginBottom: '6px', letterSpacing: '1px',
        }}>
          PURCHASE ORDER
        </div>

        {/* ── SUPPLIER / DATE INFO ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6px', fontSize: '13px' }}>
          <tbody>
            <tr>
              {/* Left: Supplier */}
              <td style={{ width: '55%', verticalAlign: 'top', paddingRight: '12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 700, paddingRight: '6px', verticalAlign: 'top', whiteSpace: 'nowrap', paddingBottom: '4px' }}>
                        Supplier:
                      </td>
                      <td style={{ borderBottom: '1px solid #555', paddingBottom: '2px', paddingLeft: '4px', verticalAlign: 'top' }}>
                        {po.supplier_name}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, paddingRight: '6px', verticalAlign: 'top', whiteSpace: 'nowrap', paddingBottom: '4px' }}>
                        Address:
                      </td>
                      <td style={{ borderBottom: '1px solid #555', paddingBottom: '2px', paddingLeft: '4px', verticalAlign: 'top' }}>
                        {po.supplier_address ?? ''}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, paddingRight: '6px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        TIN:
                      </td>
                      <td style={{ borderBottom: '1px solid #555', paddingBottom: '2px', paddingLeft: '4px', verticalAlign: 'top' }}>
                        {po.supplier_tin ?? ''}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              {/* Right: Date / Status */}
              <td style={{ width: '45%', verticalAlign: 'top' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 700, paddingRight: '6px', whiteSpace: 'nowrap', paddingBottom: '4px' }}>Date:</td>
                      <td style={{ borderBottom: '1px solid #555', paddingBottom: '2px', paddingLeft: '4px', minWidth: '100px' }}>
                        {fmtDate(po.po_date)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, paddingRight: '6px', whiteSpace: 'nowrap', paddingBottom: '4px', verticalAlign: 'top' }}>
                        Exp. Delivery Date:
                      </td>
                      <td style={{ borderBottom: '1px solid #555', paddingBottom: '2px', paddingLeft: '4px' }}>
                        {po.expected_date ? fmtDate(po.expected_date) : ''}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, paddingRight: '6px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>Status</td>
                      <td style={{ borderBottom: '1px solid #555', paddingBottom: '2px', paddingLeft: '4px' }}>
                        {po.status.replace(/_/g, ' ')}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── LINE ITEMS TABLE ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', border: BK, marginBottom: '4px', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: '#e8e8e8' }}>
              <th style={{ border: BK, padding: '4px 5px', textAlign: 'center', fontWeight: 700, width: '10%' }}>Item</th>
              <th style={{ border: BK, padding: '4px 5px', textAlign: 'center', fontWeight: 700, width: '10%' }}>Barcode</th>
              <th style={{ border: BK, padding: '4px 5px', textAlign: 'center', fontWeight: 700, width: '8%' }}>QTY</th>
              <th style={{ border: BK, padding: '4px 5px', textAlign: 'center', fontWeight: 700, width: '6%' }}>UOM</th>
              <th style={{ border: BK, padding: '4px 5px', textAlign: 'center', fontWeight: 700 }}>Description</th>
              <th style={{ border: BK, padding: '4px 5px', textAlign: 'center', fontWeight: 700, width: '9%' }}>Rate</th>
              <th style={{ border: BK, padding: '4px 5px', textAlign: 'center', fontWeight: 700, width: '12%' }}>Total Amt</th>
              <th style={{ border: BK, padding: '4px 5px', textAlign: 'center', fontWeight: 700, width: '12%' }}>Gross Amt</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => {
              const sku = l.item_sku ?? l.gl_account_code ?? '';
              const desc = l.description + (l.item_name && l.item_name !== l.description ? ` - ${l.item_name}` : '');
              return (
                <tr key={l.id}>
                  <td style={{ border: BK, padding: '4px 5px', textAlign: 'center', fontFamily: 'monospace', fontSize: '11px' }}>
                    {sku}
                  </td>
                  <td style={{ border: BK, padding: '4px 5px' }} />
                  <td style={{ border: BK, padding: '4px 5px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {fmtNum(l.quantity, 0)}
                  </td>
                  <td style={{ border: BK, padding: '4px 5px', textAlign: 'center' }}>
                    {l.item_uom ?? ''}
                  </td>
                  <td style={{ border: BK, padding: '4px 5px' }}>{desc}</td>
                  <td style={{ border: BK, padding: '4px 5px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {fmtNum(l.unit_price)}
                  </td>
                  <td style={{ border: BK, padding: '4px 5px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {fmtNum(l.line_total)}
                  </td>
                  <td style={{ border: BK, padding: '4px 5px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {fmtNum(l.line_total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ── TOTALS ── */}
        <table style={{ borderCollapse: 'collapse', marginBottom: '8px' }}>
          <tbody>
            <tr>
              <td style={{ paddingRight: '16px', fontSize: '13px' }}>Subtotal</td>
              <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                PHP{fmtNum(po.subtotal)}
              </td>
            </tr>
            <tr>
              <td style={{ paddingRight: '16px', fontSize: '13px' }}>VAT</td>
              <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                PHP{fmtNum(po.vat_amount)}
              </td>
            </tr>
            <tr>
              <td style={{ paddingRight: '16px', fontSize: '14px', fontWeight: 700 }}>Total</td>
              <td style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 700, borderTop: BK }}>
                PHP{fmtNum(po.total)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── REMARKS ── */}
        {po.remarks && (
          <div style={{ marginBottom: '12px', fontSize: '13px' }}>
            <div style={{ fontWeight: 700, marginBottom: '2px' }}>Remarks</div>
            <div style={{ paddingLeft: '4px' }}>{po.remarks}</div>
          </div>
        )}

        {/* ── SIGNATURES ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '24px', marginBottom: '20px' }}>
          <tbody>
            <tr>
              <td style={{ width: '50%', textAlign: 'center', paddingRight: '20px', verticalAlign: 'bottom' }}>
                <div style={{ borderBottom: BK, minWidth: '180px', display: 'inline-block', width: '70%', marginBottom: '4px' }}>
                  {po.created_by_name ?? ''}
                </div>
              </td>
              <td style={{ width: '50%', textAlign: 'center', paddingLeft: '20px', verticalAlign: 'bottom' }}>
                <div style={{ borderBottom: BK, minWidth: '180px', display: 'inline-block', width: '70%', marginBottom: '4px' }}>
                  {po.approved_by_name ?? ''}
                </div>
              </td>
            </tr>
            <tr>
              <td style={{ textAlign: 'center', fontWeight: 700, fontSize: '13px', paddingTop: '4px' }}>Created By</td>
              <td style={{ textAlign: 'center', fontWeight: 700, fontSize: '13px', paddingTop: '4px' }}>Approved By</td>
            </tr>
          </tbody>
        </table>

        </div>{/* end main content */}

        {/* ── CONFORME + CONDITIONS pinned to bottom ── */}
        <div style={{ marginTop: 'auto' }}>

        {/* ── CONFORME ── */}
        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>CONFORME:</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
          <tbody>
            <tr>
              <td style={{ width: '60%', textAlign: 'center', paddingRight: '20px', paddingTop: '36px', verticalAlign: 'bottom' }}>
                <div style={{ borderBottom: BK, display: 'inline-block', width: '80%', marginBottom: '4px' }}>&nbsp;</div>
              </td>
              <td style={{ width: '40%', textAlign: 'center', paddingLeft: '20px', paddingTop: '36px', verticalAlign: 'bottom' }}>
                <div style={{ borderBottom: BK, display: 'inline-block', width: '80%', marginBottom: '4px' }}>&nbsp;</div>
              </td>
            </tr>
            <tr>
              <td style={{ textAlign: 'center', fontWeight: 700, fontSize: '13px', paddingTop: '4px' }}>
                Supplier&apos;s Authorized Representative
              </td>
              <td style={{ textAlign: 'center', fontWeight: 700, fontSize: '13px', paddingTop: '4px' }}>Date</td>
            </tr>
          </tbody>
        </table>

        {/* ── CONDITIONS ── */}
        <div style={{ borderTop: '1px solid #aaa', paddingTop: '8px', fontSize: '11px', color: '#222', lineHeight: '1.4', textAlign: 'justify' }}>
          <strong>CONDITIONS:</strong> Failure of the supplier to deliver on the date and quality specified will make this P.O null and void.
          Delays incurred which are not fault of ARTFRESH will oblige the supplier to pay ARTFRESH the amount of 1% of the amount of
          the contract for everyday of delay as the liquidated damages. It is hereby understood that supplier expressly authorizes ARTFRESH
          to deduct the amount from any monies due or which may become due without prejudice to the other methods of recovery. The payment
          or deduction of such damages shall not relieve the supplier from his obligations to complete the work or any other of his obligations
          and liabilities of this contract. This is a system generated PO.
        </div>

        </div>{/* end bottom anchor */}

      </div>
    </>
  );
}
