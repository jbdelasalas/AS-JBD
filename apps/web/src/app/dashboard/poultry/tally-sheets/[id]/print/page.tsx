'use client';
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Line {
  id?: string;
  line_no: number;
  item_name?: string;
  sku?: string;
  heads: number;
  gross_kgs: number;
  crate_kgs: number;
  net_kgs: number;
  remarks: string;
}

interface Building { id: string; code: string; name: string; }

interface TallySheet {
  id: string;
  doc_no: string;
  status: string;
  tally_type: string;
  grow_cycle_no: string | null;
  supplier_name: string | null;
  destination_name: string | null;
  branch_id: string | null;
  building_id: string | null;
  reference_id: string | null;
  harvested_heads: number;
  net_heads: number;
  net_kgs: number;
  received_by: string | null;
  issued_by: string | null;
  checked_by: string | null;
  plate_number: string | null;
  driver: string | null;
  helper: string | null;
  start_time: string | null;
  end_time: string | null;
  remarks: string | null;
  transfer_date: string;
  lines: Line[];
}

interface Company {
  id: string;
  name: string | null;
  legal_name: string | null;
  address: string | null;
  logo: string | null;
}

const DATA_COLS = 12;
const ROWS_PER_SECTION = 10;

export default function TallySheetPrintPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<TallySheet | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<TallySheet>(`/poultry/tally-sheets/${id}`)
      .then(d => setDoc(d))
      .catch(() => {})
      .finally(() => setLoading(false));

    const cid = localStorage.getItem('company_id');
    if (cid) {
      api.get<Building[]>(`/poultry/buildings?company_id=${cid}`)
        .then(r => setBuildings(Array.isArray(r) ? r : []))
        .catch(() => {});
      api.get<Company>(`/companies/${cid}`)
        .then(co => setCompany(co))
        .catch(() => {});
    }
  }, [id]);

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  if (!doc) return <div className="py-12 text-center text-sm text-red-500">Not found.</div>;

  const buildingName = buildings.find(b => b.id === doc.building_id)?.name ?? '';
  const allLines = doc.lines;
  const netKgs = allLines.reduce((s, l) => s + Number(l.net_kgs), 0);
  const netHeads = allLines.reduce((s, l) => s + Number(l.heads), 0);
  const avgWeight = netHeads > 0 ? netKgs / netHeads : 0;

  const formatDate = (d: string) => {
    if (!d) return '';
    const dt = new Date(d);
    return `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}-${dt.getFullYear()}`;
  };

  function sectionLines(section: number) {
    return allLines.slice(section * ROWS_PER_SECTION, (section + 1) * ROWS_PER_SECTION);
  }

  function sectionTotals(section: number) {
    const sl = sectionLines(section);
    return {
      heads: sl.reduce((s, l) => s + Number(l.heads), 0),
      kgs: sl.reduce((s, l) => s + Number(l.net_kgs), 0),
    };
  }

  return (
    <>
      {/* Print controls */}
      <div className="print:hidden flex gap-3 p-4 border-b border-slate-200 bg-white">
        <button
          onClick={() => window.print()}
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Print / Save PDF
        </button>
        <button
          onClick={() => router.back()}
          className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          ← Back
        </button>
        <span className="ml-auto self-center text-xs text-slate-400">Use browser Print → Save as PDF for best results</span>
      </div>

      {/* ─── Print page ─── */}
      <div
        id="print-area"
        style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '8pt',
          color: '#000',
          background: '#fff',
          width: '210mm',
          margin: '0 auto',
          padding: '8mm 10mm',
          boxSizing: 'border-box',
        }}
      >
        {/* ── Company header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4pt', borderBottom: '2px solid #000', paddingBottom: '4pt' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8pt' }}>
            {/* Company logo */}
            {company?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo} alt="logo" style={{ height: '40pt', width: 'auto', objectFit: 'contain', flexShrink: 0 }} />
            ) : (
              <div style={{ width: '36pt', height: '36pt', border: '1px solid #aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '6pt', color: '#aaa', flexShrink: 0 }}>LOGO</div>
            )}
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '11pt', letterSpacing: '0.5pt', textTransform: 'uppercase' }}>{company?.legal_name || company?.name || 'ART FRESH CHICKEN CORP.'}</div>
              <div style={{ fontSize: '6.5pt', color: '#555' }}>{company?.address || 'Permit & Reg. Manapong, Victoria, Laguna'}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '8pt' }}>NO. <span style={{ fontWeight: 'bold', textDecoration: 'underline', letterSpacing: '1pt' }}>{doc.doc_no}</span></div>
            <div style={{ fontSize: '8pt', marginTop: '2pt' }}>Date: <span style={{ fontWeight: 'bold' }}>{formatDate(doc.transfer_date)}</span></div>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '11pt', letterSpacing: '3pt', marginBottom: '6pt' }}>
          LIVE TALLY SHEET
        </div>

        {/* ── Info fields ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2pt 16pt', marginBottom: '4pt', fontSize: '8pt' }}>
          <div style={{ borderBottom: '1px solid #000', paddingBottom: '1pt' }}>
            <span style={{ fontWeight: 'bold' }}>CONTRACT GROWER </span>
            <span style={{ textDecoration: 'underline' }}>{doc.supplier_name ?? ''}</span>
          </div>
          <div style={{ borderBottom: '1px solid #000', paddingBottom: '1pt' }}>
            <span style={{ fontWeight: 'bold' }}>SEAL NUMBER </span>
            <span style={{ textDecoration: 'underline' }}>{doc.reference_id ?? ''}</span>
          </div>
          <div style={{ borderBottom: '1px solid #000', paddingBottom: '1pt' }}>
            <span style={{ fontWeight: 'bold' }}>ADDRESS OF FARM </span>
            <span>&nbsp;</span>
          </div>
          <div style={{ borderBottom: '1px solid #000', paddingBottom: '1pt' }}>
            <span style={{ fontWeight: 'bold' }}>APPROVED QUANTITY </span>
            <span style={{ fontWeight: 'bold', textDecoration: 'underline' }}>{doc.harvested_heads ? doc.harvested_heads.toLocaleString() : ''}</span>
          </div>
          <div style={{ borderBottom: '1px solid #000', paddingBottom: '1pt' }}>
            <span style={{ fontWeight: 'bold' }}>BUILDING NO. </span>
            <span style={{ textDecoration: 'underline' }}>{buildingName}</span>
          </div>
          <div />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2pt 16pt', marginBottom: '6pt', fontSize: '8pt' }}>
          <div>
            <span style={{ fontWeight: 'bold' }}>TIME STARTED </span>
            <span style={{ borderBottom: '1px solid #000', display: 'inline-block', minWidth: '60pt' }}>{doc.start_time ?? ''}</span>
            <span style={{ marginLeft: '6pt', fontWeight: 'bold' }}>AM / PM</span>
          </div>
          <div>
            <span style={{ fontWeight: 'bold' }}>TIME FINISHED </span>
            <span style={{ borderBottom: '1px solid #000', display: 'inline-block', minWidth: '60pt' }}>{doc.end_time ?? ''}</span>
            <span style={{ marginLeft: '6pt', fontWeight: 'bold' }}>AM / PM</span>
          </div>
        </div>

        {/* ── Tally grid sections ── */}
        {[0, 1, 2].map(section => {
          const sl = sectionLines(section);
          const totals = sectionTotals(section);
          return (
            <div key={section} style={{ marginBottom: '6pt' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt' }}>
                <thead>
                  <tr>
                    <th style={thStyle('#f0f0f0', '14pt')}>#</th>
                    {Array.from({ length: DATA_COLS }).map((_, c) => (
                      <th key={c} style={thStyle('#f0f0f0')}></th>
                    ))}
                    <th style={thStyle('#f0f0f0', '28pt')}>Heads</th>
                    <th style={thStyle('#f0f0f0', '34pt')}>Net KGS</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: ROWS_PER_SECTION }).map((_, row) => {
                    const line = row < sl.length ? sl[row] : null;
                    return (
                      <tr key={row} style={{ height: '13pt' }}>
                        <td style={tdStyle('center')}>{row + 1}</td>
                        {Array.from({ length: DATA_COLS }).map((_, c) => (
                          <td key={c} style={tdStyle()}></td>
                        ))}
                        <td style={tdStyle('right')}>
                          {line ? Number(line.heads).toLocaleString() : ''}
                        </td>
                        <td style={tdStyle('right')}>
                          {line ? Number(line.net_kgs).toFixed(3) : ''}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#f5f5f5' }}>
                    <td style={{ ...tdStyle('center'), fontWeight: 'bold', fontSize: '7pt' }}>Total</td>
                    {Array.from({ length: DATA_COLS }).map((_, c) => (
                      <td key={c} style={tdStyle()}></td>
                    ))}
                    <td style={{ ...tdStyle('right'), fontWeight: 'bold' }}>
                      {sl.length > 0 ? totals.heads.toLocaleString() : ''}
                    </td>
                    <td style={{ ...tdStyle('right'), fontWeight: 'bold' }}>
                      {sl.length > 0 ? totals.kgs.toFixed(3) : ''}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}

        {/* ── Bottom summary ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8pt', marginBottom: '8pt' }}>
          {/* Remarks */}
          <div style={{ border: '1px solid #000', padding: '4pt', minHeight: '50pt' }}>
            <div style={{ fontWeight: 'bold', fontSize: '8pt', marginBottom: '4pt' }}>REMARKS</div>
            <div style={{ fontSize: '8pt' }}>{doc.remarks ?? ''}</div>
          </div>
          {/* Totals */}
          <div style={{ fontSize: '8pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #000', padding: '3pt 0', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 'bold' }}>TOTAL NO. OF HEADS</span>
              <span style={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: '10pt' }}>{netHeads.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #000', padding: '3pt 0', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 'bold' }}>TOTAL WEIGHT</span>
              <span style={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: '10pt' }}>{netKgs.toFixed(3)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #000', padding: '3pt 0', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 'bold' }}>AVE. WEIGHT</span>
              <span style={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: '10pt' }}>{avgWeight.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* ── Plate / Driver ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8pt', marginBottom: '6pt', fontSize: '8pt' }}>
          <div>
            <span style={{ fontWeight: 'bold' }}>PLATE NO. </span>
            <span style={{ borderBottom: '1px solid #000', display: 'inline-block', minWidth: '80pt', fontWeight: 'bold' }}>
              {doc.plate_number ?? ''}
            </span>
          </div>
          <div>
            <span style={{ fontWeight: 'bold' }}>DRIVER&apos;S NAME </span>
            <span style={{ borderBottom: '1px solid #000', display: 'inline-block', minWidth: '100pt' }}>
              {doc.driver ?? ''}
            </span>
          </div>
        </div>

        {/* ── Signatures ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8pt', fontSize: '8pt' }}>
          <div style={{ border: '1px solid #000', padding: '4pt' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '20pt' }}>RECEIVED BY:</div>
            <div style={{ borderTop: '1px solid #000', paddingTop: '2pt', minHeight: '16pt' }}>{doc.received_by ?? ''}</div>
          </div>
          <div style={{ border: '1px solid #000', padding: '4pt' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '20pt' }}>ISSUED BY:</div>
            <div style={{ borderTop: '1px solid #000', paddingTop: '2pt', minHeight: '16pt' }}>{doc.issued_by ?? ''}</div>
          </div>
          <div style={{ border: '1px solid #000', padding: '4pt' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '20pt' }}>CHECKED BY:</div>
            <div style={{ borderTop: '1px solid #000', paddingTop: '2pt', minHeight: '16pt' }}>{doc.checked_by ?? ''}</div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { margin: 0; background: #fff; }
          #print-area {
            width: 100% !important;
            margin: 0 !important;
            padding: 8mm 10mm !important;
            box-shadow: none !important;
          }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>
    </>
  );
}

function thStyle(bg: string, width?: string): React.CSSProperties {
  return {
    border: '1px solid #000',
    padding: '1pt 2pt',
    background: bg,
    textAlign: 'center',
    fontWeight: 'bold',
    width: width,
    whiteSpace: 'nowrap',
  };
}

function tdStyle(align?: 'center' | 'right' | 'left'): React.CSSProperties {
  return {
    border: '1px solid #000',
    padding: '0 2pt',
    textAlign: align ?? 'left',
    fontFamily: align === 'right' ? 'monospace' : undefined,
    height: '13pt',
    minWidth: '16pt',
  };
}
