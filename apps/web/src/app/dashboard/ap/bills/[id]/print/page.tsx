'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

function fmtDate(iso: string) {
  const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

function n2(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface BillLine {
  id: string;
  line_no: number;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  ewt_rate: number;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
  ewt_amount: number;
  account_name: string | null;
  account_code: string | null;
  item_uom: string | null;
  branch_code: string | null;
  building_code: string | null;
  cost_center_code: string | null;
  grow_ref_code: string | null;
}

interface Bill {
  id: string;
  internal_no: string;
  bill_no: string;
  bill_date: string;
  due_date: string;
  supplier_name: string;
  supplier_code: string;
  supplier_id: string;
  supplier_address: string | null;
  po_id: string | null;
  po_no: string | null;
  subtotal: number;
  vat_amount: number;
  ewt_amount: number;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
  branch_code: string | null;
  branch_name: string | null;
  building_code: string | null;
  building_name: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  grow_ref_code: string | null;
  grow_ref_name: string | null;
  ewt_code: string | null;
  ewt_code_name: string | null;
  ewt_code_rate: number | null;
  ewt_atc_code: string | null;
  je_id: string | null;
  remarks: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  lines: BillLine[];
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
  phone: string | null;
}

const B = '1px solid #000';
const cell = (extra?: React.CSSProperties): React.CSSProperties => ({ border: B, padding: '3px 5px', ...extra });
const th = (extra?: React.CSSProperties): React.CSSProperties => ({
  border: B, padding: '3px 5px', fontWeight: 'bold', textAlign: 'center',
  backgroundColor: '#f2f2f2', ...extra,
});

export default function PrintBillPage() {
  const { id } = useParams<{ id: string }>();
  const [bill, setBill] = useState<Bill | null>(null);
  const [jeLines, setJeLines] = useState<JELine[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<Bill>(`/ap/bills/${id}`),
      api.get<Company>(`/companies/${companyId}`),
    ]).then(async ([b, co]) => {
      setBill(b);
      setCompany(co);
      if (b.je_id) {
        const je = await api.get<{ lines: JELine[] }>(`/gl/journal-entries/${b.je_id}`);
        setJeLines(je.lines.map(l => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })));
      } else {
        const preview = await api.get<{ lines: JELine[] }>(`/ap/bills/${id}/journal-preview`).catch(() => ({ lines: [] }));
        setJeLines((preview.lines ?? []).map(l => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })));
      }
    }).catch(e => setError((e as Error).message)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { if (!loading && bill) setTimeout(() => window.print(), 400); }, [loading, bill]);

  if (loading) return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: '#666' }}>
      Preparing voucher…
    </div>
  );
  if (error || !bill) return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: '#c00' }}>
      {error ?? 'Bill not found'}
    </div>
  );

  const netPayable = bill.total - bill.ewt_amount;
  const statusLabel = bill.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Derive department/class/location for each line from bill-level tagging
  const dept = 'Operation';
  const classLabel = [bill.cost_center_code, bill.cost_center_name].filter(Boolean).join(' ') || null;
  const location = [bill.building_code, bill.building_name].filter(Boolean).join(' ') ||
    [bill.branch_code, bill.branch_name].filter(Boolean).join(' ') || null;

  return (
    <>
      {/* Screen toolbar */}
      <div className="print:hidden" style={{ padding: '12px 16px', display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
        <button onClick={() => window.print()} style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 16px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 }}>Print</button>
        <button onClick={() => window.close()} style={{ background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '4px', padding: '6px 16px', fontSize: '13px', cursor: 'pointer' }}>Close</button>
      </div>

      <div className="voucher" style={{ width: '210mm', margin: '0 auto', padding: '8mm 10mm 10mm', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '9.5pt', color: '#000', background: '#fff', boxSizing: 'border-box' }}>

        {/* Company Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2mm' }}>
          {company?.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logo} alt="logo" style={{ height: '64px', width: 'auto', objectFit: 'contain' }} />
          )}
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '16pt', lineHeight: 1.1, textTransform: 'uppercase' }}>
              {company?.legal_name || company?.name || ''}
            </div>
            {company?.address && (
              <div style={{ fontSize: '8pt', color: '#333', lineHeight: 1.4 }}>{company.address}</div>
            )}
            {company?.phone && (
              <div style={{ fontSize: '8pt', color: '#333' }}>Tel No. {company.phone}</div>
            )}
          </div>
        </div>

        {/* APV No. — right aligned */}
        <div style={{ textAlign: 'right', fontSize: '10pt', marginBottom: '1mm' }}>
          <span style={{ fontWeight: 'normal' }}>APV No.&nbsp;</span>
          <span style={{ fontWeight: 'bold' }}>{bill.internal_no}</span>
        </div>

        {/* Title */}
        <div style={{ textAlign: 'center', fontSize: '13pt', fontWeight: 'bold', marginBottom: '3mm', letterSpacing: '1px' }}>
          Accounts Payable Voucher
        </div>

        {/* Payee + Date box */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '3mm', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '55%' }} />
            <col style={{ width: '45%' }} />
          </colgroup>
          <tbody>
            <tr>
              <td style={{ border: B, padding: '4px 6px', verticalAlign: 'top' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ width: '70px', fontWeight: 'bold', verticalAlign: 'top', paddingBottom: '3px' }}>Payee:</td>
                      <td style={{ verticalAlign: 'top', paddingBottom: '3px', fontWeight: 'bold' }}>
                        {bill.supplier_code} {bill.supplier_name}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 'bold', verticalAlign: 'top' }}>Address:</td>
                      <td style={{ verticalAlign: 'top', fontSize: '8.5pt', lineHeight: 1.4 }}>
                        {bill.supplier_address ?? ''}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td style={{ border: B, padding: '4px 8px', verticalAlign: 'top' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ paddingBottom: '4px', width: '70px' }}>Date:</td>
                      <td style={{ paddingBottom: '4px', fontWeight: 'bold' }}>{fmtDate(bill.bill_date)}</td>
                    </tr>
                    <tr>
                      <td style={{ paddingBottom: '4px' }}>Due Date:</td>
                      <td style={{ paddingBottom: '4px' }}>{bill.due_date ? fmtDate(bill.due_date) : ''}</td>
                    </tr>
                    <tr>
                      <td>Status:</td>
                      <td style={{ fontWeight: 'bold' }}>{statusLabel}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Line items table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1mm', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '9%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={th()}>GL Acct#</th>
              <th style={th()}>GL Account Name</th>
              <th style={th()}>Description</th>
              <th style={th()}>Department</th>
              <th style={th()}>Class</th>
              <th style={th()}>Location</th>
              <th style={th()}>Total Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l, i) => {
              const lineDept = dept;
              const lineClass = [l.cost_center_code].filter(Boolean).join(' ') || classLabel || '';
              const lineLoc = [l.building_code || l.branch_code].filter(Boolean).join(' ') || location || '';
              const isLast = i === bill.lines.length - 1 && bill.ewt_amount === 0;
              return (
                <tr key={l.id}>
                  <td style={cell({ textAlign: 'center', borderBottom: isLast ? B : 'none' })}>{l.account_code ?? ''}</td>
                  <td style={cell({ borderBottom: isLast ? B : 'none' })}>{l.account_name ?? ''}</td>
                  <td style={cell({ borderBottom: isLast ? B : 'none' })}>{l.description}</td>
                  <td style={cell({ textAlign: 'center', borderBottom: isLast ? B : 'none' })}>{lineDept}</td>
                  <td style={cell({ textAlign: 'center', borderBottom: isLast ? B : 'none' })}>{lineClass}</td>
                  <td style={cell({ textAlign: 'center', borderBottom: isLast ? B : 'none' })}>{lineLoc}</td>
                  <td style={cell({ textAlign: 'right', borderBottom: isLast ? B : 'none' })}>PHP{n2(l.line_subtotal)}</td>
                </tr>
              );
            })}
            {/* EWT row */}
            {bill.ewt_amount > 0 && (
              <tr>
                <td style={cell({ textAlign: 'center' })}>
                  {jeLines.find(l => l.credit > 0 && (l.account_name?.toLowerCase().includes('withholding') || l.account_name?.toLowerCase().includes('ewt')))?.account_code ?? ''}
                </td>
                <td style={cell()}>
                  {bill.ewt_code_name
                    ? `Withholding Tax Payable - ${bill.ewt_code_name}`
                    : 'Withholding Tax Payable - Expanded'}
                </td>
                <td style={cell()}></td>
                <td style={cell({ textAlign: 'center' })}>{dept}</td>
                <td style={cell({ textAlign: 'center' })}>
                  {bill.ewt_atc_code ? `${bill.ewt_atc_code}` : classLabel ?? ''}
                </td>
                <td style={cell({ textAlign: 'center' })}>{location ?? ''}</td>
                <td style={cell({ textAlign: 'right', color: '#c00' })}>({n2(bill.ewt_amount)})</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Tax / Amount summary — right aligned */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '3mm', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '73%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <tbody>
            <tr>
              <td style={{ border: 'none' }}></td>
              <td style={{ border: 'none', textAlign: 'right', paddingRight: '6px', fontWeight: 'bold', fontSize: '9pt' }}>Tax</td>
              <td style={{ border: B, textAlign: 'right', padding: '2px 5px' }}>PHP{n2(bill.vat_amount)}</td>
            </tr>
            <tr>
              <td style={{ border: 'none' }}></td>
              <td style={{ border: 'none', textAlign: 'right', paddingRight: '6px', fontWeight: 'bold', fontSize: '9pt' }}>Amount</td>
              <td style={{ border: B, textAlign: 'right', padding: '2px 5px', borderTop: 'none', fontWeight: 'bold' }}>PHP{n2(netPayable)}</td>
            </tr>
          </tbody>
        </table>

        {/* Journal Entry / GL table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '3mm', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '9%' }} />
            <col style={{ width: '55%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={th()}>GL Acct#</th>
              <th style={th()}>GL Account Name</th>
              <th style={th()}>Debit</th>
              <th style={th()}>Credit</th>
            </tr>
          </thead>
          <tbody>
            {jeLines.map((l, i) => (
              <tr key={i}>
                <td style={cell({ textAlign: 'center' })}>{l.account_code}</td>
                <td style={cell()}>{l.account_name}</td>
                <td style={cell({ textAlign: 'right' })}>{l.debit > 0 ? n2(l.debit) : ''}</td>
                <td style={cell({ textAlign: 'right' })}>{l.credit > 0 ? n2(l.credit) : ''}</td>
              </tr>
            ))}
            {/* Totals row */}
            {jeLines.length > 0 && (() => {
              const totalDebit = jeLines.reduce((s, l) => s + l.debit, 0);
              const totalCredit = jeLines.reduce((s, l) => s + l.credit, 0);
              return (
                <tr>
                  <td style={cell({ borderTop: '2px solid #000' })}></td>
                  <td style={cell({ borderTop: '2px solid #000' })}></td>
                  <td style={cell({ textAlign: 'right', borderTop: '2px solid #000', fontWeight: 'bold' })}>{n2(totalDebit)}</td>
                  <td style={cell({ textAlign: 'right', borderTop: '2px solid #000', fontWeight: 'bold' })}>{n2(totalCredit)}</td>
                </tr>
              );
            })()}
          </tbody>
        </table>

        {/* Remarks */}
        <div style={{ marginBottom: '5mm' }}>
          <span style={{ fontWeight: 'bold' }}>Remarks: </span>
          <span style={{ fontSize: '9pt' }}>
            {bill.remarks || (bill.po_no ? `Payment for ${bill.po_no}` : `Bill ${bill.internal_no} — ${bill.supplier_name}`)}
          </span>
        </div>

        {/* Signature lines */}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '50%' }} />
            <col style={{ width: '50%' }} />
          </colgroup>
          <tbody>
            <tr>
              <td style={{ padding: '0 20px 0 0', verticalAlign: 'bottom' }}>
                <div style={{ fontSize: '9pt', marginBottom: '2mm' }}>Prepared by:</div>
                <div style={{ border: B, padding: '3px 8px', minHeight: '24px', fontWeight: 'bold' }}>
                  {bill.created_by_name ?? ' '}
                </div>
              </td>
              <td style={{ padding: '0 0 0 20px', verticalAlign: 'bottom' }}>
                <div style={{ fontSize: '9pt', marginBottom: '2mm' }}>Date:</div>
                <div style={{ border: B, padding: '3px 8px', minHeight: '24px', fontWeight: 'bold' }}>
                  {fmtDate(bill.bill_date)}
                </div>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 20px 0 0', verticalAlign: 'bottom' }}>
                <div style={{ fontSize: '9pt', marginBottom: '2mm' }}>Approved by:</div>
                <div style={{ border: B, padding: '3px 8px', minHeight: '24px', fontWeight: 'bold' }}>
                  {bill.approved_by_name ?? ' '}
                </div>
              </td>
              <td style={{ padding: '6px 0 0 20px', verticalAlign: 'bottom' }}>
                <div style={{ fontSize: '9pt', marginBottom: '2mm' }}>Date:</div>
                <div style={{ border: B, padding: '3px 8px', minHeight: '24px', fontWeight: 'bold' }}>
                  {bill.approved_by_name ? fmtDate(bill.bill_date) : ' '}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

      </div>

      <style>{`
        @media print {
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
