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

function monthPos(d: string, q: number): 0|1|2 {
  const m = new Date(d).getMonth()+1;
  return Math.max(0,Math.min(2,m-(q-1)*3-1)) as 0|1|2;
}
function fmt(n: number) { return n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}); }

/* ── Shared constants ── */
const BLK = '1px solid #000';
const F7  = {fontSize:'7px'} as const;
const F8  = {fontSize:'8px'} as const;
const F9  = {fontSize:'9px'} as const;
const BOLD = {fontWeight:700} as const;
const MONO = {fontFamily:'monospace'} as const;
const HDR_BG = {backgroundColor:'#d0d0d0'} as const;
const CELL_PAD = {padding:'2px 3px'} as const;

/* ── Individual character box ── */
function CharBox({ch,w=12,h=15}:{ch?:string,w?:number,h?:number}) {
  return (
    <span style={{
      display:'inline-block', width:`${w}px`, height:`${h}px`,
      border:BLK, ...MONO, ...F9,
      textAlign:'center', lineHeight:`${h}px`, marginRight:'0.5px',
    }}>{ch?.trim()||''}</span>
  );
}

/* ── TIN boxes: ###-###-###-##### ── */
function TinBoxes({tin}:{tin:string|null}) {
  const d = (tin??'').replace(/\D/g,'').padEnd(14,' ').split('');
  return (
    <span style={{display:'inline-flex',alignItems:'center',whiteSpace:'nowrap'}}>
      {d.slice(0,3).map((c,i)=><CharBox key={i} ch={c}/>)}
      <span style={{...F9,...BOLD,padding:'0 2px'}}>-</span>
      {d.slice(3,6).map((c,i)=><CharBox key={i} ch={c}/>)}
      <span style={{...F9,...BOLD,padding:'0 2px'}}>-</span>
      {d.slice(6,9).map((c,i)=><CharBox key={i} ch={c}/>)}
      <span style={{...F9,...BOLD,padding:'0 2px'}}>-</span>
      {d.slice(9,14).map((c,i)=><CharBox key={i} ch={c}/>)}
    </span>
  );
}

/* ── Date boxes: MM/DD/YYYY ── */
function DateBoxes({date}:{date:string}) {
  const [mm='',dd='',yyyy=''] = date.split('/');
  const b = (s:string,n:number) => s.padEnd(n,' ').split('');
  return (
    <span style={{display:'inline-flex',alignItems:'center',whiteSpace:'nowrap'}}>
      {b(mm,2).map((c,i)=><CharBox key={i} ch={c}/>)}
      <span style={{...F8,padding:'0 1px'}}>/</span>
      {b(dd,2).map((c,i)=><CharBox key={i} ch={c}/>)}
      <span style={{...F8,padding:'0 1px'}}>/</span>
      {b(yyyy,4).map((c,i)=><CharBox key={i} ch={c}/>)}
    </span>
  );
}

/* ── ZIP code boxes ── */
function ZipBoxes() {
  return (
    <span style={{display:'inline-flex',gap:'1px'}}>
      {[0,1,2,3].map(i=><span key={i} style={{display:'inline-block',width:'12px',height:'14px',border:BLK}}/>)}
    </span>
  );
}

/* ── Date issue/expiry boxes inside signature row ── */
function DateFieldBoxes() {
  return (
    <span style={{display:'inline-flex',alignItems:'center',whiteSpace:'nowrap',gap:'0.5px'}}>
      {[0,1].map(i=><CharBox key={i} w={11} h={14}/>)}
      <span style={{...F8,padding:'0 1px'}}>/</span>
      {[0,1].map(i=><CharBox key={i} w={11} h={14}/>)}
      <span style={{...F8,padding:'0 1px'}}>/</span>
      {[0,1,2,3].map(i=><CharBox key={i} w={11} h={14}/>)}
    </span>
  );
}

/* ── Blank data row for Part III ── */
function BlankRow() {
  return (
    <tr style={{height:'16px'}}>
      {[0,1,2,3,4,5,6].map(i=><td key={i} style={{border:BLK}}/>)}
    </tr>
  );
}

/* ── Signature block (used twice) ── */
function SigBlock({label}:{label:string}) {
  return (
    <>
      <tr><td style={{border:BLK,height:'48px',padding:'2px 4px',verticalAlign:'bottom',fontSize:'0px'}}>&nbsp;</td></tr>
      <tr>
        <td style={{border:BLK,borderTop:'none',...CELL_PAD,textAlign:'center',...F8}}>
          {label}
        </td>
      </tr>
      <tr>
        <td style={{border:BLK,borderTop:'none',...CELL_PAD,textAlign:'center',...F7,color:'#444',fontStyle:'italic'}}>
          (Indicate Title/Designation and TIN)
        </td>
      </tr>
      <tr>
        <td style={{border:BLK,borderTop:'none',padding:'3px 4px'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <tbody>
              <tr>
                <td style={{...F7,width:'35%',verticalAlign:'top',paddingRight:'4px'}}>
                  Tax Agent Accreditation No./<br/>Attorney&apos;s Roll No. (if applicable)
                </td>
                <td style={{borderLeft:BLK,paddingLeft:'4px',width:'32%',verticalAlign:'top'}}>
                  <div style={F7}>Date of Issue</div>
                  <div style={{marginTop:'2px'}}><DateFieldBoxes/></div>
                  <div style={{...F7,color:'#666',marginTop:'1px'}}>(MM/DD/YYYY)</div>
                </td>
                <td style={{borderLeft:BLK,paddingLeft:'4px',width:'33%',verticalAlign:'top'}}>
                  <div style={F7}>Date of Expiry</div>
                  <div style={{marginTop:'2px'}}><DateFieldBoxes/></div>
                  <div style={{...F7,color:'#666',marginTop:'1px'}}>(MM/DD/YYYY)</div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}

export default function CertificateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [cert, setCert] = useState<Cert | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Cert>(`/bir/certificates/${id}`).then(setCert).finally(()=>setLoading(false));
  },[id]);
  useEffect(()=>{load();},[load]);

  async function updateStatus(status: string) {
    setBusy(true); setMsg(null);
    try { await api.patch(`/bir/certificates/${id}`,{status}); load(); }
    catch(e:unknown){setMsg((e as Error).message??'Failed');}
    finally{setBusy(false);}
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!cert)   return <div className="py-10 text-center text-sm text-red-600">Certificate not found</div>;

  const q=cert.period_quarter, y=cert.period_year;
  const months=Q_MONTHS[q];
  const pos=monthPos(cert.bill_date,q);
  const amounts:[number,number,number]=[0,0,0];
  amounts[pos]=cert.taxable_amount;

  /* shared cell styles */
  const c  = (s?:React.CSSProperties):React.CSSProperties => ({border:BLK,...CELL_PAD,verticalAlign:'top',...F8,...s});
  const h  = (s?:React.CSSProperties):React.CSSProperties => ({...c(s),...HDR_BG,...BOLD,textAlign:'center',lineHeight:'1.3',...s});
  const n  = ():React.CSSProperties => ({...c(),...BOLD,width:'16px',textAlign:'center',verticalAlign:'top'});
  const lbl:React.CSSProperties = {...F7,color:'#333',fontStyle:'italic',display:'block',lineHeight:'1.2'};
  const val:React.CSSProperties = {...F9,...BOLD,display:'block',marginTop:'2px'};
  const fld:React.CSSProperties = {border:BLK,minHeight:'16px',marginTop:'2px',padding:'1px 3px',...F9};

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/bir/certificates" className="text-sm text-slate-500 hover:text-slate-700">← Certificates</Link>
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[cert.status]??STATUS_STYLES.draft}`}>{cert.status}</span>
        </div>
        <div className="flex gap-2">
          {cert.status==='draft'  && <button onClick={()=>updateStatus('issued')} disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Mark as Issued</button>}
          {cert.status==='issued' && <button onClick={()=>updateStatus('filed')}  disabled={busy} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Mark as Filed</button>}
          <button onClick={()=>window.print()} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Print / Save PDF</button>
          <Link href={`/dashboard/ap/bills/${cert.bill_id}`} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">View Bill</Link>
        </div>
      </div>
      {msg && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">{msg}</div>}

      {/* ════════════════════════════════════════
          BIR FORM 2307 — January 2018 (ENCS)
          ════════════════════════════════════════ */}
      <div id="form2307" style={{
        width:'210mm', margin:'0 auto', background:'#fff', color:'#000',
        fontFamily:'"Arial","Helvetica",sans-serif',
        fontSize:'8px', lineHeight:'1.2',
        padding:'5mm 6mm 5mm 6mm', boxSizing:'border-box',
      }}>

        {/* ═══ TOP BAND: BIR-Use / Seal+Gov / empty right ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse',border:BLK}}>
          <tbody>
            <tr>
              <td style={{border:BLK,width:'58px',padding:'2px 3px',verticalAlign:'top',...F7,lineHeight:'1.4'}}>
                <div>For BIR &nbsp;BCS/</div>
                <div>Use Only Item:</div>
              </td>
              <td style={{padding:'3px 4px',textAlign:'center',verticalAlign:'middle'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'6px'}}>
                  {/* Philippine Seal circle placeholder */}
                  <div style={{
                    width:'32px',height:'32px',borderRadius:'50%',border:'1px solid #555',
                    display:'flex',alignItems:'center',justifyContent:'center',
                    flexShrink:0,flexDirection:'column',lineHeight:'1.1'
                  }}>
                    <div style={{fontSize:'5px',textAlign:'center',color:'#444',fontWeight:700}}>PH</div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{...F7}}>Republic of the Philippines</div>
                    <div style={{...F8,...BOLD}}>Department of Finance</div>
                    <div style={{...F8,...BOLD}}>Bureau of Internal Revenue</div>
                  </div>
                </div>
              </td>
              <td style={{border:BLK,width:'90px'}}/>
            </tr>
          </tbody>
        </table>

        {/* ═══ TITLE BAND: Form No. / Title / Barcode ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse',border:BLK,borderTop:'none'}}>
          <tbody>
            <tr>
              {/* BIR Form No. */}
              <td style={{border:BLK,width:'90px',padding:'2px 4px',verticalAlign:'top'}}>
                <div style={{...F7}}>BIR Form No.</div>
                <div style={{fontSize:'30px',fontWeight:900,lineHeight:'1',letterSpacing:'-1px'}}>2307</div>
                <div style={{...F7}}>January 2018 (ENCS)</div>
              </td>
              {/* Title */}
              <td style={{textAlign:'center',padding:'4px 6px',verticalAlign:'middle'}}>
                <div style={{fontSize:'15px',fontWeight:900,lineHeight:'1.2'}}>Certificate of Creditable Tax</div>
                <div style={{fontSize:'15px',fontWeight:900,lineHeight:'1.2'}}>Withheld at Source</div>
              </td>
              {/* Barcode */}
              <td style={{border:BLK,width:'90px',padding:'2px 4px',verticalAlign:'top',textAlign:'right'}}>
                <div style={{
                  width:'80px',height:'28px',marginLeft:'auto',marginBottom:'2px',
                  background:'repeating-linear-gradient(90deg,#000 0,#000 1.5px,transparent 1.5px,transparent 3.5px,#000 3.5px,#000 4px,transparent 4px,transparent 6px)',
                }}/>
                <div style={{...F7,textAlign:'center'}}>2307 01/18ENCS</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ═══ INSTRUCTION ═══ */}
        <div style={{border:BLK,borderTop:'none',padding:'1.5px 4px',...F7}}>
          Fill in all applicable spaces. Mark all appropriate boxes with an &ldquo;X&rdquo;.
        </div>

        {/* ═══ FIELD 1: For the Period ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr>
              <td style={n()}>1</td>
              <td style={{...c(),padding:'3px 5px',verticalAlign:'middle'}}>
                <span style={{...F8,marginRight:'10px'}}>For the Period</span>
                <strong style={F8}>From</strong>&nbsp;
                <DateBoxes date={`${Q_STARTS[q-1]}/${y}`}/>
                <span style={{...F7,color:'#555',margin:'0 10px 0 3px'}}>(MM/DD/YYYY)</span>
                <strong style={F8}>To</strong>&nbsp;
                <DateBoxes date={`${Q_ENDS[q-1]}/${y}`}/>
                <span style={{...F7,color:'#555',marginLeft:'3px'}}>(MM/DD/YYYY)</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ═══ PART I: PAYEE ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr><td colSpan={2} style={h()}>Part I &#8211; Payee Information</td></tr>

            {/* Field 2: Payee TIN */}
            <tr>
              <td style={n()}>2</td>
              <td style={{...c(),display:'table-cell'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <tbody><tr>
                    <td style={{verticalAlign:'middle',...F8}}>Taxpayer Identification Number <em>(TIN)</em></td>
                    <td style={{textAlign:'right',verticalAlign:'middle',paddingLeft:'6px',whiteSpace:'nowrap'}}>
                      <TinBoxes tin={cert.supplier_tin}/>
                    </td>
                  </tr></tbody>
                </table>
              </td>
            </tr>

            {/* Field 3: Payee Name */}
            <tr>
              <td style={n()}>3</td>
              <td style={c()}>
                <span style={lbl}>Payee&apos;s Name <em>(Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)</em></span>
                <div style={{...fld,...val}}>{cert.supplier_name}</div>
              </td>
            </tr>

            {/* Field 4: Address + ZIP */}
            <tr>
              <td style={n()}>4</td>
              <td style={{...c(),padding:'0'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <tbody><tr>
                    <td style={{padding:'2px 3px',borderRight:BLK,width:'82%',verticalAlign:'top'}}>
                      <span style={lbl}>Registered Address</span>
                      <div style={{...fld,...F9}}>{cert.supplier_address??''}</div>
                    </td>
                    <td style={{padding:'2px 3px',width:'18%',verticalAlign:'top'}}>
                      <span style={{...F7,fontStyle:'normal' as const,display:'block',marginBottom:'2px'}}>4A ZIP Code</span>
                      <ZipBoxes/>
                    </td>
                  </tr></tbody>
                </table>
              </td>
            </tr>

            {/* Field 5: Foreign Address */}
            <tr>
              <td style={n()}>5</td>
              <td style={c()}>
                <span style={lbl}>Foreign Address, <em>if applicable</em></span>
                <div style={{...fld,...F9}}>&nbsp;</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ═══ PART II: PAYOR ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr><td colSpan={2} style={h()}>Part II &#8211; Payor Information</td></tr>

            {/* Field 6: Payor TIN */}
            <tr>
              <td style={n()}>6</td>
              <td style={{...c(),display:'table-cell'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <tbody><tr>
                    <td style={{verticalAlign:'middle',...F8}}>Taxpayer Identification Number <em>(TIN)</em></td>
                    <td style={{textAlign:'right',verticalAlign:'middle',paddingLeft:'6px',whiteSpace:'nowrap'}}>
                      <TinBoxes tin={cert.company_tin}/>
                    </td>
                  </tr></tbody>
                </table>
              </td>
            </tr>

            {/* Field 7: Payor Name */}
            <tr>
              <td style={n()}>7</td>
              <td style={c()}>
                <span style={lbl}>Payor&apos;s Name <em>(Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)</em></span>
                <div style={{...fld,...val}}>{cert.company_name}</div>
              </td>
            </tr>

            {/* Field 8: Address + ZIP */}
            <tr>
              <td style={n()}>8</td>
              <td style={{...c(),padding:'0'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <tbody><tr>
                    <td style={{padding:'2px 3px',borderRight:BLK,width:'82%',verticalAlign:'top'}}>
                      <span style={lbl}>Registered Address</span>
                      <div style={{...fld,...F9}}>{cert.company_address??''}</div>
                    </td>
                    <td style={{padding:'2px 3px',width:'18%',verticalAlign:'top'}}>
                      <span style={{...F7,fontStyle:'normal' as const,display:'block',marginBottom:'2px'}}>8A ZIP Code</span>
                      <ZipBoxes/>
                    </td>
                  </tr></tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ═══ PART III: TABLE ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr><td colSpan={7} style={h()}>Part III &#8211; Details of Monthly Income Payments and Taxes Withheld</td></tr>
            <tr>
              <th style={h({width:'32%',verticalAlign:'middle'})} rowSpan={2}>
                Income Payments Subject to Expanded<br/>Withholding Tax
              </th>
              <th style={h({width:'6%',verticalAlign:'middle'})} rowSpan={2}>ATC</th>
              <th style={h()} colSpan={3}>AMOUNT OF INCOME PAYMENTS</th>
              <th style={h({width:'11%',verticalAlign:'middle'})} rowSpan={2}>Total</th>
              <th style={h({width:'12%',verticalAlign:'middle'})} rowSpan={2}>Tax Withheld for the<br/>Quarter</th>
            </tr>
            <tr>
              {[0,1,2].map(i=>(
                <th key={i} style={h({width:'13%'})}>
                  {['1st','2nd','3rd'][i]} Month of the<br/>Quarter<br/>
                  <span style={{...F7,fontWeight:400}}>({months[i]})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* ── Section A: EWT data row ── */}
            <tr>
              <td style={c()}>
                {cert.atc_description??'Income payment subject to expanded withholding tax'}
                <div style={{...F7,color:'#555',marginTop:'1px'}}>
                  {cert.internal_no} / {cert.bill_no} ({formatDate(cert.bill_date)})
                </div>
              </td>
              <td style={c({textAlign:'center',...BOLD})}>{cert.bir_atc_code}</td>
              {amounts.map((a,i)=>(
                <td key={i} style={c({textAlign:'right',...MONO})}>{a>0?fmt(a):''}</td>
              ))}
              <td style={c({textAlign:'right',...MONO,...BOLD})}>{fmt(cert.taxable_amount)}</td>
              <td style={c({textAlign:'right',...MONO,...BOLD})}>{fmt(cert.amount_withheld)}</td>
            </tr>
            {/* 9 blank rows */}
            {Array.from({length:9},(_,i)=><BlankRow key={i}/>)}
            {/* Total A */}
            <tr style={HDR_BG}>
              <td colSpan={2} style={c({...BOLD})}>Total</td>
              {amounts.map((a,i)=><td key={i} style={c({textAlign:'right',...MONO,...BOLD})}>{a>0?fmt(a):''}</td>)}
              <td style={c({textAlign:'right',...MONO,...BOLD})}>{fmt(cert.taxable_amount)}</td>
              <td style={c({textAlign:'right',...MONO,...BOLD})}>{fmt(cert.amount_withheld)}</td>
            </tr>
            {/* Section B header */}
            <tr>
              <td colSpan={7} style={c({...BOLD,...HDR_BG})}>
                Money Payments Subject to Withholding of<br/>Business Tax (Government &amp; Private)
              </td>
            </tr>
            {/* 8 blank rows */}
            {Array.from({length:8},(_,i)=><BlankRow key={100+i}/>)}
            {/* Total B */}
            <tr style={HDR_BG}>
              <td colSpan={2} style={c({...BOLD})}>Total</td>
              <td style={c()}></td><td style={c()}></td>
              <td style={c()}></td><td style={c()}></td>
              <td style={c()}></td>
            </tr>
          </tbody>
        </table>

        {/* ═══ DECLARATION ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr>
              <td style={{border:BLK,padding:'4px 6px',...F7,lineHeight:'1.5',textAlign:'justify'}}>
                &nbsp;&nbsp;&nbsp;&nbsp;We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and
                correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. Further, we give our consent to
                the processing of our information as contemplated under the *Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.
              </td>
            </tr>
          </tbody>
        </table>

        {/* ═══ SIGNATURE BLOCK 1: PAYOR ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <SigBlock label="Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent"/>
          </tbody>
        </table>

        {/* ═══ CONFORME ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr>
              <td style={{border:BLK,borderTop:'none',padding:'3px 4px',textAlign:'center',...F9,...BOLD,...HDR_BG}}>
                CONFORME:
              </td>
            </tr>
          </tbody>
        </table>

        {/* ═══ SIGNATURE BLOCK 2: PAYEE ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <SigBlock label="Signature over Printed Name of Payee/Payee's Authorized Representative/Tax Agent"/>
          </tbody>
        </table>

        {/* ═══ FOOTNOTE ═══ */}
        <div style={{...F7,marginTop:'3px'}}>
          *NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)
        </div>

        {/* Internal ref — screen only */}
        <div className="print:hidden" style={{
          marginTop:'10px',borderTop:'1px solid #ddd',paddingTop:'6px',
          fontSize:'11px',color:'#555',
        }}>
          <strong style={{color:'#333'}}>Certificate No.:</strong> {cert.cert_no}&nbsp;&nbsp;
          <strong style={{color:'#333'}}>Bill:</strong> {cert.internal_no}&nbsp;&nbsp;
          <strong style={{color:'#333'}}>Q{q} {y}</strong>&nbsp;&nbsp;
          <strong style={{color:'#333'}}>Status:</strong> {cert.status}
          {cert.issued_at&&<span> &nbsp;·&nbsp;<strong style={{color:'#333'}}>Issued:</strong> {formatDate(cert.issued_at)}</span>}
        </div>
      </div>

      <style>{`
        @media print {
          body > * { display:none !important; }
          #form2307 { display:block !important; position:static !important; }
          @page { size:A4; margin:0; }
        }
      `}</style>
    </div>
  );
}
