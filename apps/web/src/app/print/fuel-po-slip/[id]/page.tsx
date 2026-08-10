'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

// Print rendition of the pre-printed Purchase Order (P.O.) Slip booklet page.
// The top half is filled in when the slip is issued; everything below the dashed
// rule is left blank for the station to accomplish by hand at the pump — unless
// the slip has already been redeemed, in which case the captured values are
// printed back onto it (an office copy of the completed chit).

const ENTITIES = ['PPC', 'ARTPRO', 'ARTFRESH', 'JHTC'] as const;

interface Slip {
  id: string;
  slip_no: string;
  entity_code: string;
  issue_date: string;
  issued_to_name: string;
  position_dept: string | null;
  plate_no: string | null;
  product: string;
  quantity_litres: number | null;
  status: string;
  station_name: string | null;
  gas_up_at: string | null;
  odometer_km: number | null;
  actual_litres: number | null;
  official_receipt_no: string | null;
  catered_by: string | null;
  amount: number | null;
  employee_name: string | null;
  vehicle_description: string | null;
  approved_by_name: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${fmtDate(iso)} ${d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`;
}

function fmtNum(n: number | null, dec = 2): string {
  if (n == null) return '';
  return n.toLocaleString('en-PH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** A labelled field whose value sits on a printed rule. */
function Field({ label, value, labelWidth = '38mm' }: { label: string; value: string; labelWidth?: string }) {
  return (
    <tr>
      <td style={{ fontSize: '10pt', paddingTop: '3.2mm', whiteSpace: 'nowrap', width: labelWidth, verticalAlign: 'bottom' }}>
        {label}
      </td>
      <td style={{
        borderBottom: '1px solid #000',
        paddingTop: '3.2mm',
        paddingLeft: '2mm',
        paddingBottom: '0.4mm',
        fontSize: '10.5pt',
        fontFamily: 'Georgia, "Times New Roman", serif',
        verticalAlign: 'bottom',
        minWidth: '60mm',
      }}>
        {value || ' '}
      </td>
    </tr>
  );
}

export default function FuelPOSlipPrintPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  // ?copy=station|hr — the booklet is carbon-copied; this labels which copy
  // is being reprinted. Defaults to the station copy shown on the pad.
  const copy = searchParams.get('copy') === 'hr' ? 'HR & Admin Copy' : 'Station Copy';
  // ?blank=1 prints the station half empty even for a redeemed slip, so a
  // spoiled chit can be re-issued to the driver.
  const forceBlank = searchParams.get('blank') === '1';

  const [slip, setSlip] = useState<Slip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Slip>(`/fuel/po-slips/${id}`)
      .then(setSlip)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && slip) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [loading, slip]);

  if (loading) {
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', textAlign: 'center', paddingTop: '4rem', color: '#555' }}>
        Loading…
      </div>
    );
  }
  if (!slip) {
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', textAlign: 'center', paddingTop: '4rem', color: '#c00' }}>
        P.O. slip not found.
      </div>
    );
  }

  const showStation = slip.status === 'redeemed' && !forceBlank;
  const productLabel = slip.product.charAt(0).toUpperCase() + slip.product.slice(1);

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #fff !important; color: #000 !important; color-scheme: light !important; }
        @media print {
          @page { size: A5 portrait; margin: 0; }
          .no-print { display: none !important; }
          #slip-print {
            width: 148mm !important;
            height: 210mm !important;
            padding: 12mm 12mm 10mm 12mm !important;
            margin: 0 !important;
            box-shadow: none !important;
            page-break-after: avoid;
          }
        }
        @media screen {
          body { background: #e0e0e0 !important; }
          #slip-print { margin: 24px auto; box-shadow: 0 2px 12px rgba(0,0,0,0.15); }
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
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
          No. {slip.slip_no} · {copy}
        </span>
      </div>

      {/* ── The slip ── */}
      <div id="slip-print" style={{
        width: '148mm',
        height: '210mm',
        background: '#fff',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '10pt',
        color: '#000',
        padding: '12mm',
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* ── Entity tick-boxes ── */}
        <div style={{ display: 'flex', gap: '7mm', marginBottom: '5mm' }}>
          {ENTITIES.map((code) => {
            const checked = slip.entity_code === code;
            return (
              <span key={code} style={{ display: 'flex', alignItems: 'center', gap: '1.5mm', fontSize: '9pt', fontWeight: 700 }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '3.6mm',
                  height: '3.6mm',
                  border: '1px solid #000',
                  fontSize: '8pt',
                  lineHeight: 1,
                  fontWeight: 700,
                }}>
                  {checked ? '✓' : ' '}
                </span>
                {code}
              </span>
            );
          })}
        </div>

        {/* ── Title + booklet number ── */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4mm', marginBottom: '3mm' }}>
          <div style={{ fontSize: '12.5pt', fontWeight: 900, letterSpacing: '0.2pt' }}>
            PURCHASE ORDER (P.O.) SLIP
          </div>
          <div style={{ fontSize: '12pt', fontWeight: 700, whiteSpace: 'nowrap' }}>
            N<span style={{ fontSize: '8pt', verticalAlign: 'super' }}>o</span>&nbsp;
            <span style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{slip.slip_no}</span>
          </div>
        </div>

        {/* ── Issued-to portion (filled in-house) ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Field label="Issued to" value={slip.issued_to_name} />
            <Field label="Position / Dept." value={slip.position_dept ?? ''} />
            <Field
              label="Vehicle / Plate No."
              value={slip.plate_no ?? ''}
            />
            <Field label="Product" value={productLabel} />
            <Field
              label="Quantity in Liters"
              value={slip.quantity_litres != null ? fmtNum(slip.quantity_litres, 0) : ''}
            />
          </tbody>
        </table>

        {/* ── Dashed divider ── */}
        <div style={{
          borderTop: '1.2px dashed #000',
          marginTop: '5mm',
          marginBottom: '2mm',
          position: 'relative',
        }} />
        <div style={{ fontSize: '9.5pt', fontStyle: 'italic', marginBottom: '1mm' }}>
          This portion to be accomplished by station
        </div>

        {/* ── Station portion ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Field label="Company / Station" value={showStation ? (slip.station_name ?? '') : ''} />
            <Field label="Date / Time of Gas-up" value={showStation ? fmtDateTime(slip.gas_up_at) : ''} />
            <Field label="Milage / KM Reading" value={showStation && slip.odometer_km != null ? fmtNum(slip.odometer_km, 0) : ''} />
            <Field label="Actual Gas-Up Liters" value={showStation ? fmtNum(slip.actual_litres) : ''} />
            <Field label="Official Receipt #" value={showStation ? (slip.official_receipt_no ?? '') : ''} />
            <Field label="Catered by" value={showStation ? (slip.catered_by ?? '') : ''} />
          </tbody>
        </table>

        {/* "Amount in Php." sits to the right of the Catered-by rule on the pad */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '3.2mm' }}>
          <tbody>
            <tr>
              <td style={{ fontSize: '10pt', whiteSpace: 'nowrap', width: '38mm', verticalAlign: 'bottom' }}>
                Amount in Php.
              </td>
              <td style={{
                borderBottom: '1px solid #000',
                paddingLeft: '2mm',
                paddingBottom: '0.4mm',
                fontSize: '10.5pt',
                fontFamily: 'Georgia, "Times New Roman", serif',
                verticalAlign: 'bottom',
              }}>
                {showStation ? fmtNum(slip.amount) : ' '}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ fontSize: '8.5pt', textAlign: 'center', marginTop: '1.2mm' }}>
          Name &amp; Signature of Forecourt Team Member
        </div>

        {/* ── Bottom block: approval + warning ── */}
        <div style={{ marginTop: 'auto', paddingTop: '6mm' }}>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '5mm' }}>
            <tbody>
              <tr>
                <td style={{ fontSize: '10pt', whiteSpace: 'nowrap', width: '42mm', verticalAlign: 'bottom' }}>
                  Issued and approved by.:
                </td>
                <td style={{
                  borderBottom: '1px solid #000',
                  paddingLeft: '2mm',
                  paddingBottom: '0.4mm',
                  fontSize: '10.5pt',
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  textAlign: 'center',
                  verticalAlign: 'bottom',
                }}>
                  {slip.approved_by_name ?? ' '}
                </td>
              </tr>
              <tr>
                <td />
                <td style={{ fontSize: '8.5pt', textAlign: 'center', paddingTop: '0.8mm' }}>
                  HR &amp; Admin Dept./Dept. Manager
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '6mm' }}>
            <div style={{
              border: '1.2px solid #000',
              padding: '2.2mm 3mm',
              fontSize: '10pt',
              fontWeight: 900,
              lineHeight: 1.25,
              textAlign: 'center',
            }}>
              DO NOT ACCEPT IF<br />W/O SIGNATURE
            </div>
            <div style={{ fontSize: '9.5pt', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
              {copy}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
