'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Cert {
  id: string; cert_no: string; status: string;
  period_year: number; period_quarter: number;
  bir_atc_code: string; atc_description: string | null;
  taxable_amount: number; rate_pct: number; amount_withheld: number;
  issued_at: string | null; filed_at: string | null; created_at: string;
  bill_id: string; bill_no: string; internal_no: string; bill_date: string;
  supplier_id: string; supplier_name: string; supplier_tin: string | null; supplier_address: string | null;
  company_name: string; company_tin: string | null; company_address: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700', issued: 'bg-blue-100 text-blue-700', filed: 'bg-emerald-100 text-emerald-700',
};

const Q_STARTS = ['01/01','04/01','07/01','10/01'];
const Q_ENDS   = ['03/31','06/30','09/30','12/31'];
const Q_MONTHS: Record<number,[string,string,string]> = {
  1:['January','February','March'], 2:['April','May','June'],
  3:['July','August','September'],  4:['October','November','December'],
};

function monthPos(billDate: string, q: number): 0|1|2 {
  const m = new Date(billDate).getMonth() + 1;
  return Math.max(0, Math.min(2, m - (q-1)*3 - 1)) as 0|1|2;
}
function fmt(n: number) { return n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}); }

/* TIN box row — shows individual character boxes */
function TinBoxes({ tin }: { tin: string | null }) {
  const digits = (tin ?? '').replace(/\D/g,'').padEnd(14,' ').split('');
  const box = (ch: string, key: number) => (
    <span key={key} style={{
      display:'inline-block', width:'14px', height:'16px', border:'1px solid #555',
      fontSize:'9px', textAlign:'center', lineHeight:'16px', marginRight:'1px',
      fontFamily:'monospace'
    }}>{ch.trim()}</span>
  );
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:'1px',marginLeft:'8px'}}>
      {digits.slice(0,3).map((c,i)=>box(c,i))}
      <span style={{margin:'0 2px',fontSize:'10px',fontWeight:'bold'}}>-</span>
      {digits.slice(3,6).map((c,i)=>box(c,3+i))}
      <span style={{margin:'0 2px',fontSize:'10px',fontWeight:'bold'}}>-</span>
      {digits.slice(6,9).map((c,i)=>box(c,6+i))}
      <span style={{margin:'0 2px',fontSize:'10px',fontWeight:'bold'}}>-</span>
      {digits.slice(9,14).map((c,i)=>box(c,9+i))}
    </span>
  );
}

/* Date box row — shows MM/DD/YYYY in individual boxes */
function DateBoxes({ date }: { date: string }) {
  const parts = date.split('/'); // MM/DD/YYYY
  const mm = (parts[0]??'').padEnd(2,' ').split('');
  const dd = (parts[1]??'').padEnd(2,' ').split('');
  const yyyy = (parts[2]??'').padEnd(4,' ').split('');
  const box = (ch: string, key: number) => (
    <span key={key} style={{
      display:'inline-block', width:'13px', height:'15px', border:'1px solid #555',
      fontSize:'8px', textAlign:'center', lineHeight:'15px', marginRight:'1px',
      fontFamily:'monospace'
    }}>{ch.trim()}</span>
  );
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:'0px'}}>
      {mm.map((c,i)=>box(c,i))}
      <span style={{margin:'0 1px',fontSize:'9px',fontWeight:'bold'}}>/</span>
      {dd.map((c,i)=>box(c,2+i))}
      <span style={{margin:'0 1px',fontSize:'9px',fontWeight:'bold'}}>/</span>
      {yyyy.map((c,i)=>box(c,4+i))}
    </span>
  );
}

/* ZIP code boxes */
function ZipBoxes() {
  return (
    <span style={{display:'inline-flex',gap:'1px'}}>
      {[0,1,2,3].map(i=>(
        <span key={i} style={{display:'inline-block',width:'12px',height:'14px',border:'1px solid #555'}}></span>
      ))}
    </span>
  );
}

const B = '1px solid black';

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

  const q = cert.period_quarter, y = cert.period_year;
  const months = Q_MONTHS[q];
  const pos = monthPos(cert.bill_date, q);
  const amounts:[number,number,number] = [0,0,0];
  amounts[pos] = cert.taxable_amount;

  const cell = (style?: React.CSSProperties) => ({border:B, padding:'2px 4px', verticalAlign:'top' as const, ...style});
  const hdrCell = (style?: React.CSSProperties) => ({...cell(style), backgroundColor:'#d9d9d9', fontWeight:700 as const, textAlign:'center' as const, fontSize:'8px'});
  const numCell = { border:B, padding:'2px 3px', width:'16px', textAlign:'center' as const, fontWeight:700 as const, fontSize:'8px', verticalAlign:'top' as const };
  const lbl = { fontSize:'7px', color:'#333', display:'block' as const, fontStyle:'italic' as const };
  const val = { fontSize:'9px', fontWeight:700 as const, display:'block' as const };

  const blankRow = (k: number) => (
    <tr key={k} style={{height:'16px'}}>
      <td style={{border:B}}></td><td style={{border:B}}></td>
      <td style={{border:B}}></td><td style={{border:B}}></td>
      <td style={{border:B}}></td><td style={{border:B}}></td>
      <td style={{border:B}}></td>
    </tr>
  );

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/bir/certificates" className="text-sm text-slate-500 hover:text-slate-700">← Certificates</Link>
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[cert.status]??STATUS_STYLES.draft}`}>{cert.status}</span>
        </div>
        <div className="flex gap-2">
          {cert.status==='draft' && <button onClick={()=>updateStatus('issued')} disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Mark as Issued</button>}
          {cert.status==='issued' && <button onClick={()=>updateStatus('filed')} disabled={busy} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Mark as Filed</button>}
          <button onClick={()=>window.print()} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Print / Save PDF</button>
          <Link href={`/dashboard/ap/bills/${cert.bill_id}`} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">View Bill</Link>
        </div>
      </div>
      {msg && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">{msg}</div>}

      {/* ══════════════════════════════════════════
          BIR FORM 2307  —  January 2018 (ENCS)
          ══════════════════════════════════════════ */}
      <div id="form2307" style={{
        width:'210mm', margin:'0 auto', background:'#fff', color:'#000',
        fontFamily:'Arial,Helvetica,sans-serif', fontSize:'8px',
        padding:'5mm 5mm 5mm 5mm', boxSizing:'border-box',
      }}>

        {/* ── ROW 1: BIR-use / seal / gov text ── */}
        <table style={{width:'100%', borderCollapse:'collapse', border:B}}>
          <tbody>
            <tr>
              {/* For BIR Use Only */}
              <td style={{border:B, width:'55px', padding:'2px 4px', fontSize:'7px', lineHeight:'1.4', verticalAlign:'top'}}>
                <div>For BIR</div>
                <div>Use Only</div>
                <div style={{marginTop:'3px'}}>BCS/</div>
                <div>Item:</div>
              </td>
              {/* Seal + Government */}
              <td style={{textAlign:'center', padding:'3px 8px', verticalAlign:'middle'}}>
                {/* Philippine Government Seal placeholder */}
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'8px'}}>
                  <div style={{
                    width:'36px',height:'36px',borderRadius:'50%',border:'1.5px solid #555',
                    display:'flex',alignItems:'center',justifyContent:'center',fontSize:'6px',
                    color:'#666', flexShrink:0, textAlign:'center',lineHeight:'1.1'
                  }}>PH<br/>SEAL</div>
                  <div>
                    <div style={{fontSize:'8px'}}>Republic of the Philippines</div>
                    <div style={{fontSize:'9px',fontWeight:700}}>Department of Finance</div>
                    <div style={{fontSize:'9px',fontWeight:700}}>Bureau of Internal Revenue</div>
                  </div>
                </div>
              </td>
              {/* empty right for top row */}
              <td style={{border:B, width:'100px'}}></td>
            </tr>
          </tbody>
        </table>

        {/* ── ROW 2: Form No. / Title / Barcode ── */}
        <table style={{width:'100%',borderCollapse:'collapse',border:B,borderTop:'none'}}>
          <tbody>
            <tr>
              {/* BIR Form No. box */}
              <td style={{border:B,width:'90px',padding:'2px 4px',verticalAlign:'top'}}>
                <div style={{fontSize:'7px'}}>BIR Form No.</div>
                <div style={{fontSize:'32px',fontWeight:900,lineHeight:'1',letterSpacing:'-1px'}}>2307</div>
                <div style={{fontSize:'7px'}}>January 2018 (ENCS)</div>
              </td>
              {/* Title */}
              <td style={{textAlign:'center',padding:'6px 8px',verticalAlign:'middle'}}>
                <div style={{fontSize:'18px',fontWeight:900,lineHeight:'1.2'}}>
                  Certificate of Creditable Tax
                </div>
                <div style={{fontSize:'18px',fontWeight:900,lineHeight:'1.2'}}>
                  Withheld at Source
                </div>
              </td>
              {/* Barcode area */}
              <td style={{border:B,width:'90px',padding:'2px 4px',textAlign:'right',verticalAlign:'top'}}>
                {/* Barcode placeholder */}
                <div style={{
                  width:'80px',height:'30px',background:'repeating-linear-gradient(90deg,#000 0,#000 2px,#fff 2px,#fff 4px)',
                  marginLeft:'auto',marginBottom:'2px'
                }}></div>
                <div style={{fontSize:'7px',textAlign:'center'}}>2307 01/18ENCS</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── INSTRUCTION ── */}
        <div style={{fontSize:'7px',padding:'2px 0 1px 0',borderLeft:B,borderRight:B,borderBottom:B,paddingLeft:'4px'}}>
          Fill in all applicable spaces. Mark all appropriate boxes with an &ldquo;X&rdquo;.
        </div>

        {/* ── FIELD 1: For the Period ── */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr>
              <td style={numCell}>1</td>
              <td style={{...cell(),padding:'3px 6px'}}>
                <span style={{fontSize:'8px',marginRight:'12px'}}>For the Period</span>
                <span style={{fontSize:'8px',marginRight:'6px'}}><strong>From</strong></span>
                <DateBoxes date={`${Q_STARTS[q-1]}/${y}`} />
                <span style={{fontSize:'7px',color:'#666',marginLeft:'3px',marginRight:'16px'}}>(MM/DD/YYYY)</span>
                <span style={{fontSize:'8px',marginRight:'6px'}}><strong>To</strong></span>
                <DateBoxes date={`${Q_ENDS[q-1]}/${y}`} />
                <span style={{fontSize:'7px',color:'#666',marginLeft:'3px'}}>(MM/DD/YYYY)</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── PART I: PAYEE ── */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr><td colSpan={2} style={hdrCell()}>Part I &#8211; Payee Information</td></tr>

            {/* Field 2: TIN */}
            <tr>
              <td style={numCell}>2</td>
              <td style={{...cell(), display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap'}}>
                <span style={{fontSize:'8px'}}>Taxpayer Identification Number <em style={{fontStyle:'italic'}}>(TIN)</em></span>
                <TinBoxes tin={cert.supplier_tin} />
              </td>
            </tr>

            {/* Field 3: Payee Name */}
            <tr>
              <td style={numCell}>3</td>
              <td style={cell()}>
                <div style={lbl}>Payee&apos;s Name <em>(Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)</em></div>
                <div style={{border:B, minHeight:'16px', marginTop:'2px', padding:'1px 3px', ...val as React.CSSProperties}}>
                  {cert.supplier_name}
                </div>
              </td>
            </tr>

            {/* Field 4: Address + ZIP */}
            <tr>
              <td style={numCell}>4</td>
              <td style={{...cell(), padding:'0'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <tbody>
                    <tr>
                      <td style={{padding:'2px 4px', width:'85%', borderRight:B}}>
                        <div style={lbl}>Registered Address</div>
                        <div style={{border:B, minHeight:'16px', marginTop:'2px', padding:'1px 3px', fontSize:'9px'}}>
                          {cert.supplier_address ?? ''}
                        </div>
                      </td>
                      <td style={{padding:'2px 4px', width:'15%', verticalAlign:'top'}}>
                        <div style={{...lbl,fontStyle:'normal' as const}}>4A ZIP Code</div>
                        <div style={{marginTop:'2px'}}><ZipBoxes /></div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            {/* Field 5: Foreign Address */}
            <tr>
              <td style={numCell}>5</td>
              <td style={cell()}>
                <div style={lbl}>Foreign Address, <em>if applicable</em></div>
                <div style={{border:B, minHeight:'14px', marginTop:'2px', padding:'1px 3px', fontSize:'9px'}}>&nbsp;</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── NOTE between parts ── */}
        <div style={{fontSize:'6.5px',textAlign:'right',borderLeft:B,borderRight:B,borderBottom:B,padding:'1px 4px',color:'#555'}}>
          *NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)
        </div>

        {/* ── PART II: PAYOR ── */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr><td colSpan={2} style={hdrCell()}>Part II &#8211; Payor Information</td></tr>

            {/* Field 6: TIN */}
            <tr>
              <td style={numCell}>6</td>
              <td style={{...cell(), display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap'}}>
                <span style={{fontSize:'8px'}}>Taxpayer Identification Number <em style={{fontStyle:'italic'}}>(TIN)</em></span>
                <TinBoxes tin={cert.company_tin} />
              </td>
            </tr>

            {/* Field 7: Payor Name */}
            <tr>
              <td style={numCell}>7</td>
              <td style={cell()}>
                <div style={lbl}>Payor&apos;s Name <em>(Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)</em></div>
                <div style={{border:B, minHeight:'16px', marginTop:'2px', padding:'1px 3px', ...val as React.CSSProperties}}>
                  {cert.company_name}
                </div>
              </td>
            </tr>

            {/* Field 8: Address + ZIP */}
            <tr>
              <td style={numCell}>8</td>
              <td style={{...cell(), padding:'0'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <tbody>
                    <tr>
                      <td style={{padding:'2px 4px', width:'85%', borderRight:B}}>
                        <div style={lbl}>Registered Address</div>
                        <div style={{border:B, minHeight:'16px', marginTop:'2px', padding:'1px 3px', fontSize:'9px'}}>
                          {cert.company_address ?? ''}
                        </div>
                      </td>
                      <td style={{padding:'2px 4px', width:'15%', verticalAlign:'top'}}>
                        <div style={{...lbl,fontStyle:'normal' as const}}>8A ZIP Code</div>
                        <div style={{marginTop:'2px'}}><ZipBoxes /></div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── PART III: INCOME PAYMENTS TABLE ── */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr>
              <td colSpan={7} style={hdrCell()}>
                Part III &#8211; Details of Monthly Income Payments and Taxes Withheld
              </td>
            </tr>
            <tr>
              <th style={{...hdrCell({width:'32%',verticalAlign:'middle'}),lineHeight:'1.3'}} rowSpan={2}>
                Income Payments Subject to Expanded<br/>Withholding Tax
              </th>
              <th style={{...hdrCell({width:'7%',verticalAlign:'middle'})}} rowSpan={2}>ATC</th>
              <th style={hdrCell()} colSpan={3}>AMOUNT OF INCOME PAYMENTS</th>
              <th style={{...hdrCell({width:'12%',verticalAlign:'middle'}),lineHeight:'1.3'}} rowSpan={2}>Total</th>
              <th style={{...hdrCell({width:'13%',verticalAlign:'middle'}),lineHeight:'1.3'}} rowSpan={2}>
                Tax Withheld for the<br/>Quarter
              </th>
            </tr>
            <tr>
              {[0,1,2].map(i=>(
                <th key={i} style={{...hdrCell({width:'12%'}),lineHeight:'1.3'}}>
                  {i===0?'1st':i===1?'2nd':'3rd'} Month of the<br/>Quarter<br/>
                  <span style={{fontWeight:400,fontSize:'7px'}}>({months[i]})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* ── Section A: EWT ── */}
            {/* Data row */}
            <tr>
              <td style={{border:B,padding:'2px 4px',fontSize:'8px'}}>
                {cert.atc_description ?? 'Income payment subject to expanded withholding tax'}
                <div style={{fontSize:'7px',color:'#555'}}>
                  {cert.internal_no} / {cert.bill_no} — {formatDate(cert.bill_date)}
                </div>
              </td>
              <td style={{border:B,padding:'2px 3px',textAlign:'center',fontWeight:700,fontSize:'8px'}}>{cert.bir_atc_code}</td>
              {amounts.map((a,i)=>(
                <td key={i} style={{border:B,padding:'2px 3px',textAlign:'right',fontFamily:'monospace',fontSize:'8px'}}>
                  {a>0?fmt(a):''}
                </td>
              ))}
              <td style={{border:B,padding:'2px 3px',textAlign:'right',fontFamily:'monospace',fontWeight:700,fontSize:'8px'}}>
                {fmt(cert.taxable_amount)}
              </td>
              <td style={{border:B,padding:'2px 3px',textAlign:'right',fontFamily:'monospace',fontWeight:700,fontSize:'8px'}}>
                {fmt(cert.amount_withheld)}
              </td>
            </tr>
            {/* 9 blank rows */}
            {Array.from({length:9},(_,i)=>blankRow(i))}
            {/* Total A */}
            <tr style={{backgroundColor:'#e8e8e8'}}>
              <td colSpan={2} style={{border:B,padding:'2px 4px',fontWeight:700,fontSize:'8px'}}>Total</td>
              {amounts.map((a,i)=>(
                <td key={i} style={{border:B,padding:'2px 3px',textAlign:'right',fontFamily:'monospace',fontWeight:700,fontSize:'8px'}}>
                  {a>0?fmt(a):''}
                </td>
              ))}
              <td style={{border:B,padding:'2px 3px',textAlign:'right',fontFamily:'monospace',fontWeight:700,fontSize:'8px'}}>
                {fmt(cert.taxable_amount)}
              </td>
              <td style={{border:B,padding:'2px 3px',textAlign:'right',fontFamily:'monospace',fontWeight:700,fontSize:'8px'}}>
                {fmt(cert.amount_withheld)}
              </td>
            </tr>
            {/* Section B header */}
            <tr>
              <td colSpan={7} style={{border:B,padding:'2px 4px',fontWeight:700,fontSize:'8px',backgroundColor:'#d9d9d9'}}>
                Money Payments Subject to Withholding of<br/>Business Tax (Government &amp; Private)
              </td>
            </tr>
            {/* 8 blank rows */}
            {Array.from({length:8},(_,i)=>blankRow(100+i))}
            {/* Total B */}
            <tr style={{backgroundColor:'#e8e8e8'}}>
              <td colSpan={2} style={{border:B,padding:'2px 4px',fontWeight:700,fontSize:'8px'}}>Total</td>
              <td style={{border:B}}></td><td style={{border:B}}></td>
              <td style={{border:B}}></td><td style={{border:B}}></td>
              <td style={{border:B}}></td>
            </tr>
          </tbody>
        </table>

        {/* ── DECLARATION ── */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr>
              <td style={{border:B,padding:'4px 6px',fontSize:'7px',lineHeight:'1.6',textAlign:'justify'}}>
                &nbsp;&nbsp;&nbsp;&nbsp;We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and
                correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. Further, we give our consent to
                the processing of our information as contemplated under the *Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── SIGNATURE BLOCK 1: PAYOR ── */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr>
              <td style={{border:B,height:'50px',verticalAlign:'bottom',padding:'2px 4px'}}>
                {/* blank space for signature */}
              </td>
            </tr>
            <tr>
              <td style={{border:B,borderTop:'none',padding:'2px 4px',textAlign:'center',fontSize:'8px'}}>
                Signature over Printed Name of Payor/Payor&apos;s Authorized Representative/Tax Agent
              </td>
            </tr>
            <tr>
              <td style={{border:B,borderTop:'none',padding:'1px 4px',textAlign:'center',fontSize:'7px',fontStyle:'italic',color:'#444'}}>
                (Indicate Title/Designation and TIN)
              </td>
            </tr>
            <tr>
              <td style={{border:B,borderTop:'none',padding:'3px 4px'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <tbody>
                    <tr>
                      <td style={{fontSize:'7px',width:'36%',verticalAlign:'top',paddingRight:'6px'}}>
                        Tax Agent Accreditation No./<br/>Attorney&apos;s Roll No. (if applicable)
                      </td>
                      <td style={{borderLeft:B,paddingLeft:'6px',width:'32%',verticalAlign:'top'}}>
                        <div style={{fontSize:'7px'}}>Date of Issue</div>
                        <div style={{display:'flex',gap:'1px',marginTop:'2px'}}>
                          {[0,1].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                          <span style={{padding:'0 1px',fontSize:'8px'}}>/</span>
                          {[0,1].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                          <span style={{padding:'0 1px',fontSize:'8px'}}>/</span>
                          {[0,1,2,3].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                        </div>
                        <div style={{fontSize:'6px',color:'#666',marginTop:'1px'}}>(MM/DD/YYYY)</div>
                      </td>
                      <td style={{borderLeft:B,paddingLeft:'6px',width:'32%',verticalAlign:'top'}}>
                        <div style={{fontSize:'7px'}}>Date of Expiry</div>
                        <div style={{display:'flex',gap:'1px',marginTop:'2px'}}>
                          {[0,1].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                          <span style={{padding:'0 1px',fontSize:'8px'}}>/</span>
                          {[0,1].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                          <span style={{padding:'0 1px',fontSize:'8px'}}>/</span>
                          {[0,1,2,3].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                        </div>
                        <div style={{fontSize:'6px',color:'#666',marginTop:'1px'}}>(MM/DD/YYYY)</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── CONFORME ── */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr>
              <td style={{border:B,borderTop:'none',padding:'3px 4px',textAlign:'center',fontWeight:700,fontSize:'9px',backgroundColor:'#f0f0f0'}}>
                CONFORME:
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── SIGNATURE BLOCK 2: PAYEE ── */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr>
              <td style={{border:B,borderTop:'none',height:'50px',verticalAlign:'bottom',padding:'2px 4px'}}>
                {/* blank space for payee signature */}
              </td>
            </tr>
            <tr>
              <td style={{border:B,borderTop:'none',padding:'2px 4px',textAlign:'center',fontSize:'8px'}}>
                Signature over Printed Name of Payee/Payee&apos;s Authorized Representative/Tax Agent
              </td>
            </tr>
            <tr>
              <td style={{border:B,borderTop:'none',padding:'1px 4px',textAlign:'center',fontSize:'7px',fontStyle:'italic',color:'#444'}}>
                (Indicate Title/Designation and TIN)
              </td>
            </tr>
            <tr>
              <td style={{border:B,borderTop:'none',padding:'3px 4px'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <tbody>
                    <tr>
                      <td style={{fontSize:'7px',width:'36%',verticalAlign:'top',paddingRight:'6px'}}>
                        Tax Agent Accreditation No./<br/>Attorney&apos;s Roll No. (if applicable)
                      </td>
                      <td style={{borderLeft:B,paddingLeft:'6px',width:'32%',verticalAlign:'top'}}>
                        <div style={{fontSize:'7px'}}>Date of Issue</div>
                        <div style={{display:'flex',gap:'1px',marginTop:'2px'}}>
                          {[0,1].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                          <span style={{padding:'0 1px',fontSize:'8px'}}>/</span>
                          {[0,1].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                          <span style={{padding:'0 1px',fontSize:'8px'}}>/</span>
                          {[0,1,2,3].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                        </div>
                        <div style={{fontSize:'6px',color:'#666',marginTop:'1px'}}>(MM/DD/YYYY)</div>
                      </td>
                      <td style={{borderLeft:B,paddingLeft:'6px',width:'32%',verticalAlign:'top'}}>
                        <div style={{fontSize:'7px'}}>Date of Expiry</div>
                        <div style={{display:'flex',gap:'1px',marginTop:'2px'}}>
                          {[0,1].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                          <span style={{padding:'0 1px',fontSize:'8px'}}>/</span>
                          {[0,1].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                          <span style={{padding:'0 1px',fontSize:'8px'}}>/</span>
                          {[0,1,2,3].map(i=><span key={i} style={{display:'inline-block',width:'13px',height:'14px',border:'1px solid #555'}}></span>)}
                        </div>
                        <div style={{fontSize:'6px',color:'#666',marginTop:'1px'}}>(MM/DD/YYYY)</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── FOOTNOTE ── */}
        <div style={{fontSize:'6.5px',marginTop:'3px'}}>
          *NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)
        </div>

        {/* Internal ref — screen only */}
        <div className="print:hidden" style={{marginTop:'10px',borderTop:'1px solid #ddd',paddingTop:'6px',fontSize:'11px',color:'#666'}}>
          <strong style={{color:'#333'}}>Certificate No.:</strong> {cert.cert_no} &nbsp;·&nbsp;
          <strong style={{color:'#333'}}>Bill:</strong> {cert.internal_no} &nbsp;·&nbsp;
          <strong style={{color:'#333'}}>Q{q} {y}</strong> &nbsp;·&nbsp;
          <strong style={{color:'#333'}}>Status:</strong> {cert.status}
          {cert.issued_at && <span> · <strong style={{color:'#333'}}>Issued:</strong> {formatDate(cert.issued_at)}</span>}
        </div>
      </div>

      <style>{`
        @media print {
          body > * { display: none !important; }
          #form2307 { display: block !important; position: static !important; }
          @page { size: A4; margin: 0; }
        }
      `}</style>
    </div>
  );
}
