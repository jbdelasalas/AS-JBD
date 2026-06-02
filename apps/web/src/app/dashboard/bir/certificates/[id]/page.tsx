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

const STATUS_STYLES: Record<string,string> = {
  draft:'bg-slate-100 text-slate-700', issued:'bg-blue-100 text-blue-700', filed:'bg-emerald-100 text-emerald-700',
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

/* ── Single character box ── */
function CB({v='',w=12,h=14}:{v?:string,w?:number,h?:number}) {
  return <span style={{display:'inline-block',width:w,height:h,border:'1px solid #777',
    fontSize:'8px',fontFamily:'Arial',textAlign:'center',lineHeight:`${h}px`,
    marginRight:'0.5px',verticalAlign:'middle'}}>{v.trim()}</span>;
}

/* ── TIN: ###-###-###-##### ── */
function TIN({tin}:{tin:string|null}) {
  const d=(tin??'').replace(/\D/g,'').padEnd(14,' ').split('');
  return <span style={{display:'inline-flex',alignItems:'center',verticalAlign:'middle'}}>
    {d.slice(0,3).map((c,i)=><CB key={i} v={c}/>)}
    <span style={{margin:'0 2px',fontSize:'9px',fontWeight:700}}>-</span>
    {d.slice(3,6).map((c,i)=><CB key={i} v={c}/>)}
    <span style={{margin:'0 2px',fontSize:'9px',fontWeight:700}}>-</span>
    {d.slice(6,9).map((c,i)=><CB key={i} v={c}/>)}
    <span style={{margin:'0 2px',fontSize:'9px',fontWeight:700}}>-</span>
    {d.slice(9,14).map((c,i)=><CB key={i} v={c}/>)}
  </span>;
}

/* ── Date boxes: MM/DD/YYYY ── */
function DBx({date}:{date:string}) {
  const [mm='',dd='',yyyy=''] = date.split('/');
  const pad=(s:string,n:number)=>s.padEnd(n,' ').split('');
  return <span style={{display:'inline-flex',alignItems:'center',verticalAlign:'middle'}}>
    {pad(mm,2).map((c,i)=><CB key={i} v={c}/>)}
    <span style={{margin:'0 1px',fontSize:'8px',fontWeight:700}}>/</span>
    {pad(dd,2).map((c,i)=><CB key={i} v={c}/>)}
    <span style={{margin:'0 1px',fontSize:'8px',fontWeight:700}}>/</span>
    {pad(yyyy,4).map((c,i)=><CB key={i} v={c}/>)}
  </span>;
}

/* ── ZIP boxes ── */
function ZIP() {
  return <span style={{display:'inline-flex',gap:'1px'}}>
    {[0,1,2,3].map(i=><CB key={i} w={11} h={13}/>)}
  </span>;
}

/* ── Date field boxes (for signature rows) ── */
function DBOX() {
  return <span style={{display:'inline-flex',alignItems:'center',verticalAlign:'middle'}}>
    <CB w={11} h={13}/><CB w={11} h={13}/>
    <span style={{margin:'0 1px',fontSize:'8px',fontWeight:700}}>/</span>
    <CB w={11} h={13}/><CB w={11} h={13}/>
    <span style={{margin:'0 1px',fontSize:'8px',fontWeight:700}}>/</span>
    <CB w={11} h={13}/><CB w={11} h={13}/><CB w={11} h={13}/><CB w={11} h={13}/>
  </span>;
}

/* ─── Style constants ─── */
const BK = '1px solid #000';
const GR = {backgroundColor:'#d0d0d0'} as const;
const cp = {padding:'2px 4px'} as const;
const f7 = {fontSize:'7px'} as const;
const f8 = {fontSize:'8px'} as const;
const f9 = {fontSize:'9px'} as const;
const bold = {fontWeight:700 as const};
const italic = {fontStyle:'italic' as const};
const mono = {fontFamily:'monospace'} as const;

/* ── Field row for Parts I & II ──
   Left  (~45%): blank with field number centered
   Right (~55%): label + input                   */
function FRow({n,children,h=28}:{n:number,children:React.ReactNode,h?:number}) {
  return <tr>
    <td style={{border:BK,width:'45%',textAlign:'center',verticalAlign:'middle',...f9,...bold,minHeight:h}}>
      {n}
    </td>
    <td style={{border:BK,width:'55%',padding:'2px 4px',verticalAlign:'top'}}>
      {children}
    </td>
  </tr>;
}

/* ── Blank Part III row ── */
function BR() {
  return <tr style={{height:'15px'}}>
    {[0,1,2,3,4,5,6].map(i=><td key={i} style={{border:BK}}/>)}
  </tr>;
}

/* ── Signature block ── */
function SIG({label}:{label:string}) {
  return <>
    <tr><td style={{border:BK,height:'44px',verticalAlign:'bottom',...cp,fontSize:'0px'}}>&nbsp;</td></tr>
    <tr><td style={{border:BK,borderTop:'none',...cp,textAlign:'center',...f8}}>{label}</td></tr>
    <tr><td style={{border:BK,borderTop:'none',...cp,textAlign:'center',...f7,...italic,color:'#444'}}>(Indicate Title/Designation and TIN)</td></tr>
    <tr>
      <td style={{border:BK,borderTop:'none',padding:'3px 4px'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody><tr>
            <td style={{...f7,width:'34%',verticalAlign:'top',paddingRight:'4px'}}>
              Tax Agent Accreditation No./<br/>Attorney&apos;s Roll No. <em>(if applicable)</em>
            </td>
            <td style={{borderLeft:BK,paddingLeft:'4px',width:'33%',verticalAlign:'top'}}>
              <div style={f7}>Date of Issue</div>
              <div style={{marginTop:'2px'}}><DBOX/></div>
              <div style={{...f7,color:'#666'}}>(MM/DD/YYYY)</div>
            </td>
            <td style={{borderLeft:BK,paddingLeft:'4px',width:'33%',verticalAlign:'top'}}>
              <div style={f7}>Date of Expiry</div>
              <div style={{marginTop:'2px'}}><DBOX/></div>
              <div style={{...f7,color:'#666'}}>(MM/DD/YYYY)</div>
            </td>
          </tr></tbody>
        </table>
      </td>
    </tr>
  </>;
}

export default function CertificateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [cert, setCert] = useState<Cert|null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string|null>(null);

  const load = useCallback(()=>{
    setLoading(true);
    api.get<Cert>(`/bir/certificates/${id}`).then(setCert).finally(()=>setLoading(false));
  },[id]);
  useEffect(()=>{load();},[load]);

  async function updateStatus(status:string) {
    setBusy(true); setMsg(null);
    try{await api.patch(`/bir/certificates/${id}`,{status});load();}
    catch(e:unknown){setMsg((e as Error).message??'Failed');}
    finally{setBusy(false);}
  }

  if (loading) return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!cert)   return <div className="py-10 text-center text-sm text-red-600">Certificate not found</div>;

  const q=cert.period_quarter, y=cert.period_year;
  const months=Q_MONTHS[q];
  const pos=monthPos(cert.bill_date,q);
  const am:[number,number,number]=[0,0,0];
  am[pos]=cert.taxable_amount;

  const hc=(extra?:React.CSSProperties):React.CSSProperties=>({border:BK,...cp,...GR,...bold,...f8,textAlign:'center',lineHeight:'1.3',...extra});
  const dc=(extra?:React.CSSProperties):React.CSSProperties=>({border:BK,...cp,...f8,verticalAlign:'top',...extra});

  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/bir/certificates" className="text-sm text-slate-500 hover:text-slate-700">← Certificates</Link>
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[cert.status]??STATUS_STYLES.draft}`}>{cert.status}</span>
        </div>
        <div className="flex gap-2">
          {cert.status==='draft'  && <button onClick={()=>updateStatus('issued')} disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Mark as Issued</button>}
          {cert.status==='issued' && <button onClick={()=>updateStatus('filed')}  disabled={busy} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">Mark as Filed</button>}
          <button
            onClick={() => {
              const token = localStorage.getItem('access_token') ?? '';
              window.open(`/api/v1/bir/certificates/${id}/pdf?token=${token}`, '_blank');
            }}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
            Download PDF
          </button>
          <Link href={`/dashboard/ap/bills/${cert.bill_id}`} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">View Bill</Link>
        </div>
      </div>
      {msg && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">{msg}</div>}

      {/* ════════════════════════════════════
          BIR FORM 2307  January 2018 (ENCS)
          ════════════════════════════════════ */}
      <div id="form2307" style={{
        width:'216mm',margin:'0 auto',background:'#fff',color:'#000',
        fontFamily:'Arial,Helvetica,sans-serif',fontSize:'8px',lineHeight:'1.2',
        padding:'5mm 6mm 4mm 6mm',boxSizing:'border-box',
      }}>

        {/* ═══ HEADER BAND 1: BIR-use | Seal+Gov | empty ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse',border:BK}}>
          <tbody><tr>
            {/* For BIR Use Only */}
            <td style={{border:BK,width:'72px',padding:'2px 4px',verticalAlign:'top',...f7,lineHeight:'1.5'}}>
              <div>For BIR &nbsp; BCS/</div>
              <div>Use Only</div>
              <div>Item:</div>
            </td>
            {/* Seal + Gov */}
            <td style={{padding:'4px',textAlign:'center',verticalAlign:'middle'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'8px'}}>
                <div style={{
                  width:'34px',height:'34px',borderRadius:'50%',border:'1px solid #888',
                  display:'flex',alignItems:'center',justifyContent:'center',
                  flexShrink:0,flexDirection:'column' as const,
                }}>
                  <span style={{fontSize:'5px',fontWeight:700,color:'#666',textAlign:'center',lineHeight:'1.2'}}>PH<br/>SEAL</span>
                </div>
                <div>
                  <div style={f7}>Republic of the Philippines</div>
                  <div style={{...f8,...bold}}>Department of Finance</div>
                  <div style={{...f8,...bold}}>Bureau of Internal Revenue</div>
                </div>
              </div>
            </td>
            {/* empty top-right */}
            <td style={{border:BK,width:'100px'}}/>
          </tr></tbody>
        </table>

        {/* ═══ HEADER BAND 2: Form No. | Title | Barcode ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse',border:BK,borderTop:'none'}}>
          <tbody><tr>
            {/* BIR Form No. */}
            <td style={{border:BK,width:'95px',padding:'2px 5px',verticalAlign:'top'}}>
              <div style={f7}>BIR Form No.</div>
              <div style={{fontSize:'30px',fontWeight:900,lineHeight:'1',letterSpacing:'-1px'}}>2307</div>
              <div style={f7}>January 2018 (ENCS)</div>
            </td>
            {/* Title */}
            <td style={{textAlign:'center',padding:'6px 8px',verticalAlign:'middle'}}>
              <div style={{fontSize:'16px',fontWeight:900,lineHeight:'1.15'}}>Certificate of Creditable Tax</div>
              <div style={{fontSize:'16px',fontWeight:900,lineHeight:'1.15'}}>Withheld at Source</div>
            </td>
            {/* Barcode */}
            <td style={{border:BK,width:'95px',padding:'3px 4px',verticalAlign:'top',textAlign:'right'}}>
              <div style={{
                width:'82px',height:'30px',marginLeft:'auto',marginBottom:'2px',
                background:'repeating-linear-gradient(90deg,#000 0,#000 1.5px,#fff 1.5px,#fff 3.5px,#000 3.5px,#000 4.5px,#fff 4.5px,#fff 6px)',
              }}/>
              <div style={{...f7,textAlign:'center'}}>2307 01/18ENCS</div>
            </td>
          </tr></tbody>
        </table>

        {/* ═══ INSTRUCTION ═══ */}
        <div style={{border:BK,borderTop:'none',padding:'1.5px 4px',...f7}}>
          Fill in all applicable spaces. Mark all appropriate boxes with an &ldquo;X&rdquo;.
        </div>

        {/* ═══ FIELD 1: For the Period ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody><tr>
            <td style={{border:BK,width:'20px',textAlign:'center',verticalAlign:'middle',...f9,...bold,padding:'2px 3px'}}>1</td>
            <td style={{border:BK,padding:'3px 5px',verticalAlign:'middle'}}>
              <span style={{...f8,marginRight:'8px'}}>For the Period</span>
              <strong style={f8}>From</strong>&nbsp;
              <DBx date={`${Q_STARTS[q-1]}/${y}`}/>
              <span style={{...f7,color:'#666',margin:'0 8px 0 2px'}}>(MM/DD/YYYY)</span>
              <strong style={f8}>To</strong>&nbsp;
              <DBx date={`${Q_ENDS[q-1]}/${y}`}/>
              <span style={{...f7,color:'#666',marginLeft:'2px'}}>(MM/DD/YYYY)</span>
            </td>
          </tr></tbody>
        </table>

        {/* ═══ PART I: PAYEE ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr><td colSpan={2} style={hc()}>Part I &#8211; Payee Information</td></tr>

            {/* Field 2: Payee TIN */}
            <FRow n={2}>
              <div style={{...f8,marginBottom:'2px'}}>Taxpayer Identification Number <em style={italic}>(TIN)</em></div>
              <TIN tin={cert.supplier_tin}/>
            </FRow>

            {/* Field 3: Payee Name */}
            <FRow n={3} h={36}>
              <div style={{...f7,...italic,color:'#333',marginBottom:'2px'}}>
                Payee&apos;s Name <em>(Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)</em>
              </div>
              <div style={{border:BK,minHeight:'16px',padding:'1px 3px',...f9,...bold}}>
                {cert.supplier_name}
              </div>
            </FRow>

            {/* Field 4: Address + ZIP */}
            <FRow n={4} h={32}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <tbody><tr>
                  <td style={{width:'82%',paddingRight:'4px',verticalAlign:'top'}}>
                    <div style={{...f7,...italic,color:'#333',marginBottom:'2px'}}>Registered Address</div>
                    <div style={{border:BK,minHeight:'16px',padding:'1px 3px',...f9}}>
                      {cert.supplier_address??''}
                    </div>
                  </td>
                  <td style={{borderLeft:BK,paddingLeft:'4px',width:'18%',verticalAlign:'top'}}>
                    <div style={{...f7,marginBottom:'2px'}}>4A ZIP Code</div>
                    <ZIP/>
                  </td>
                </tr></tbody>
              </table>
            </FRow>

            {/* Field 5: Foreign Address */}
            <FRow n={5} h={28}>
              <div style={{...f7,...italic,color:'#333',marginBottom:'2px'}}>Foreign Address, <em>if applicable</em></div>
              <div style={{border:BK,minHeight:'14px',padding:'1px 3px',...f9}}>&nbsp;</div>
            </FRow>
          </tbody>
        </table>

        {/* BIR Data Privacy note (between Part I and Part II) */}
        <div style={{border:BK,borderTop:'none',padding:'1px 4px',textAlign:'right',...f7,color:'#444',fontStyle:'italic'}}>
          *NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)
        </div>

        {/* ═══ PART II: PAYOR ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            <tr><td colSpan={2} style={hc()}>Part II &#8211; Payor Information</td></tr>

            {/* Field 6: Payor TIN */}
            <FRow n={6}>
              <div style={{...f8,marginBottom:'2px'}}>Taxpayer Identification Number <em style={italic}>(TIN)</em></div>
              <TIN tin={cert.company_tin}/>
            </FRow>

            {/* Field 7: Payor Name */}
            <FRow n={7} h={36}>
              <div style={{...f7,...italic,color:'#333',marginBottom:'2px'}}>
                Payor&apos;s Name <em>(Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)</em>
              </div>
              <div style={{border:BK,minHeight:'16px',padding:'1px 3px',...f9,...bold}}>
                {cert.company_name}
              </div>
            </FRow>

            {/* Field 8: Address + ZIP */}
            <FRow n={8} h={32}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <tbody><tr>
                  <td style={{width:'82%',paddingRight:'4px',verticalAlign:'top'}}>
                    <div style={{...f7,...italic,color:'#333',marginBottom:'2px'}}>Registered Address</div>
                    <div style={{border:BK,minHeight:'16px',padding:'1px 3px',...f9}}>
                      {cert.company_address??''}
                    </div>
                  </td>
                  <td style={{borderLeft:BK,paddingLeft:'4px',width:'18%',verticalAlign:'top'}}>
                    <div style={{...f7,marginBottom:'2px'}}>8A ZIP Code</div>
                    <ZIP/>
                  </td>
                </tr></tbody>
              </table>
            </FRow>
          </tbody>
        </table>

        {/* ═══ PART III ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr><td colSpan={7} style={hc()}>Part III &#8211; Details of Monthly Income Payments and Taxes Withheld</td></tr>
            <tr>
              <th style={hc({width:'30%',verticalAlign:'middle'})} rowSpan={2}>
                Income Payments Subject to Expanded<br/>Withholding Tax
              </th>
              <th style={hc({width:'7%',verticalAlign:'middle'})} rowSpan={2}>ATC</th>
              <th style={hc()} colSpan={3}>AMOUNT OF INCOME PAYMENTS</th>
              <th style={hc({width:'11%',verticalAlign:'middle'})} rowSpan={2}>Total</th>
              <th style={hc({width:'12%',verticalAlign:'middle'})} rowSpan={2}>Tax Withheld for the<br/>Quarter</th>
            </tr>
            <tr>
              {[0,1,2].map(i=>(
                <th key={i} style={hc({width:'13%'})}>
                  {['1st','2nd','3rd'][i]} Month of the<br/>Quarter<br/>
                  <span style={{...f7,fontWeight:400}}>({months[i]})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Data row */}
            <tr>
              <td style={dc()}>
                <div style={{...f8}}>{cert.atc_description??'Income payment subject to EWT'}</div>
                <div style={{...f7,color:'#555',marginTop:'1px'}}>{cert.internal_no} / {cert.bill_no} &#8212; {formatDate(cert.bill_date)}</div>
              </td>
              <td style={dc({textAlign:'center',...bold})}>{cert.bir_atc_code}</td>
              {am.map((a,i)=><td key={i} style={dc({textAlign:'right',...mono})}>{a>0?fmt(a):''}</td>)}
              <td style={dc({textAlign:'right',...mono,...bold})}>{fmt(cert.taxable_amount)}</td>
              <td style={dc({textAlign:'right',...mono,...bold})}>{fmt(cert.amount_withheld)}</td>
            </tr>
            {/* 9 blank rows */}
            {Array.from({length:9},(_,i)=><BR key={i}/>)}
            {/* Total A */}
            <tr style={GR}>
              <td colSpan={2} style={dc({...bold})}>Total</td>
              {am.map((a,i)=><td key={i} style={dc({textAlign:'right',...mono,...bold})}>{a>0?fmt(a):''}</td>)}
              <td style={dc({textAlign:'right',...mono,...bold})}>{fmt(cert.taxable_amount)}</td>
              <td style={dc({textAlign:'right',...mono,...bold})}>{fmt(cert.amount_withheld)}</td>
            </tr>
            {/* Section B */}
            <tr>
              <td colSpan={7} style={dc({...bold,...GR})}>
                Money Payments Subject to Withholding of<br/>Business Tax (Government &amp; Private)
              </td>
            </tr>
            {Array.from({length:8},(_,i)=><BR key={100+i}/>)}
            <tr style={GR}>
              <td colSpan={2} style={dc({...bold})}>Total</td>
              {[0,1,2,3,4].map(i=><td key={i} style={dc()}/>)}
            </tr>
          </tbody>
        </table>

        {/* ═══ DECLARATION ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody><tr>
            <td style={{border:BK,...cp,...f7,lineHeight:'1.55',textAlign:'justify'}}>
              &nbsp;&nbsp;&nbsp;&nbsp;We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. Further, we give our consent to the processing of our information as contemplated under the *Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.
            </td>
          </tr></tbody>
        </table>

        {/* ═══ SIGNATURE: PAYOR ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody><SIG label="Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent"/></tbody>
        </table>

        {/* ═══ CONFORME ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody><tr>
            <td style={{border:BK,borderTop:'none',...cp,textAlign:'center',...f9,...bold,...GR}}>
              CONFORME:
            </td>
          </tr></tbody>
        </table>

        {/* ═══ SIGNATURE: PAYEE ═══ */}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody><SIG label="Signature over Printed Name of Payee/Payee's Authorized Representative/Tax Agent"/></tbody>
        </table>

        {/* ═══ FOOTNOTE ═══ */}
        <div style={{...f7,marginTop:'2px'}}>
          *NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)
        </div>

        {/* Internal ref — screen only */}
        <div className="print:hidden" style={{marginTop:'10px',borderTop:'1px solid #ddd',paddingTop:'6px',fontSize:'11px',color:'#555'}}>
          <strong style={{color:'#333'}}>Certificate No.:</strong> {cert.cert_no} &nbsp;·&nbsp;
          <strong style={{color:'#333'}}>Bill:</strong> {cert.internal_no} &nbsp;·&nbsp;
          <strong style={{color:'#333'}}>Q{q} {y}</strong> &nbsp;·&nbsp;
          <strong style={{color:'#333'}}>Status:</strong> {cert.status}
          {cert.issued_at&&<span> &nbsp;·&nbsp; <strong style={{color:'#333'}}>Issued:</strong> {formatDate(cert.issued_at)}</span>}
        </div>
      </div>

      <style>{`
        @media print {
          body > * { display:none !important; }
          #form2307 { display:block !important; position:static !important; }
          @page { size: 8.5in 13in; margin:0; }
        }
      `}</style>
    </div>
  );
}
