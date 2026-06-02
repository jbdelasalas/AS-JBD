export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { query } from '@/lib/db';
import { requireAuth, verifyAccess } from '@/lib/auth-helpers';
import { PDFDocument, rgb, StandardFonts, LineCapStyle } from 'pdf-lib';

const Q_STARTS = ['01/01','04/01','07/01','10/01'];
const Q_ENDS   = ['03/31','06/30','09/30','12/31'];
const Q_MONTHS: Record<number,[string,string,string]> = {
  1:['January','February','March'],
  2:['April','May','June'],
  3:['July','August','September'],
  4:['October','November','December'],
};

function monthPos(d:string,q:number):0|1|2 {
  const m=new Date(d).getMonth()+1;
  return Math.max(0,Math.min(2,m-(q-1)*3-1)) as 0|1|2;
}
function fmt(n:number){return n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}

export async function GET(request:NextRequest,{params}:{params:{id:string}}) {
  // Accept token from Authorization header OR ?token= query param
  const qToken = request.nextUrl.searchParams.get('token')??'';
  if (qToken) {
    const p = await verifyAccess(qToken);
    if (!p?.sub) return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{'Content-Type':'application/json'}});
  } else {
    try { await requireAuth(request); } catch(e){ return e as Response; }
  }

  const rows = await query(
    `SELECT wc.*,
            b.bill_no,b.internal_no,b.bill_date,
            s.name AS supplier_name,s.tin AS supplier_tin,s.address AS supplier_address,
            co.name AS company_name,co.bir_tin AS company_tin,co.registered_address AS company_address
       FROM wht_certificates wc
       JOIN bills b     ON b.id=wc.bill_id
       JOIN suppliers s ON s.id=wc.supplier_id
       JOIN companies co ON co.id=wc.company_id
      WHERE wc.id=$1 LIMIT 1`,
    [params.id],
  );
  if(!rows[0]) return new Response('Not found',{status:404});
  const cert=rows[0] as Record<string,unknown>;

  const q  = Number(cert.period_quarter);
  const y  = Number(cert.period_year);
  const months = Q_MONTHS[q];
  const pos = monthPos(String(cert.bill_date),q);
  const am:[number,number,number]=[0,0,0];
  am[pos]=Number(cert.taxable_amount);

  /* ── PDF setup ── */
  const pdf  = await PDFDocument.create();
  const page = pdf.addPage([612,936]); // 8.5×13 in long bond
  const W=612, H=936;

  // Embed real seal & barcode images
  const sealPng    = readFileSync(join(process.cwd(),'public/bir/image1.png'));
  const barcodePng = readFileSync(join(process.cwd(),'public/bir/image2.png'));
  const sealImg    = await pdf.embedPng(sealPng);
  const barcodeImg = await pdf.embedPng(barcodePng);

  const helv  = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const helvI = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const BK = rgb(0,0,0);
  const GY = rgb(0.82,0.82,0.82);
  const GY2= rgb(0.90,0.90,0.90);
  const DGY= rgb(0.4,0.4,0.4);
  const LGY= rgb(0.3,0.3,0.3);

  const ML=17,MR=17,MT=14;
  const TW=W-ML-MR; // 578pt content width

  function ln(x1:number,y1:number,x2:number,y2:number,w=0.5){
    page.drawLine({start:{x:x1,y:H-y1},end:{x:x2,y:H-y2},thickness:w,color:BK,lineCap:LineCapStyle.Butt});
  }
  function box(x:number,y:number,w:number,h:number,fill?:ReturnType<typeof rgb>){
    page.drawRectangle({x,y:H-y-h,width:w,height:h,
      color:fill,borderWidth:0.5,borderColor:BK});
  }
  function txt(t:string,x:number,y:number,sz:number,font=helv,color=BK,
               opts:{align?:'center'|'right',maxW?:number}={}) {
    if(!t) return;
    let px=x;
    if(opts.align==='center') px=x-font.widthOfTextAtSize(t,sz)/2;
    if(opts.align==='right')  px=x-font.widthOfTextAtSize(t,sz);
    if(opts.maxW){
      while(t.length>1&&font.widthOfTextAtSize(t,sz)>opts.maxW) t=t.slice(0,-1);
    }
    page.drawText(t,{x:px,y:H-y,size:sz,font,color});
  }

  function cboxes(val:string,x:number,y:number,n:number,bw=8.5,bh=9){
    const ch=val.replace(/\D/g,'').padEnd(n,' ').split('');
    let cx=x;
    for(let i=0;i<n;i++){
      box(cx,y,bw,bh);
      if(ch[i]?.trim()) txt(ch[i],cx+bw/2,y+bh-1.5,6,helv,BK,{align:'center'});
      cx+=bw+0.5;
    }
  }
  function tin(val:string|null,x:number,y:number){
    const d=(val??'').replace(/\D/g,'');
    cboxes(d,x,y,3); x+=3*9; txt('-',x+1,y+7,7); x+=8;
    cboxes(d.slice(3),x,y,3); x+=3*9; txt('-',x+1,y+7,7); x+=8;
    cboxes(d.slice(6),x,y,3); x+=3*9; txt('-',x+1,y+7,7); x+=8;
    cboxes(d.slice(9),x,y,5);
  }
  function datebox(s:string,x:number,y:number){
    const[mm='',dd='',yyyy='']=s.split('/');
    cboxes(mm,x,y,2); x+=2*9+2; txt('/',x-1,y+7,7); x+=4;
    cboxes(dd,x,y,2); x+=2*9+2; txt('/',x-1,y+7,7); x+=4;
    cboxes(yyyy,x,y,4);
  }
  function zipbox(x:number,y:number){
    for(let i=0;i<4;i++) box(x+i*9.5,y,8.5,9);
  }
  function hdr(label:string,x:number,y:number,w:number,h=11){
    box(x,y,w,h,GY);
    txt(label,x+w/2,y+h-3,7,helvB,BK,{align:'center'});
  }

  let Y=MT;

  /* ════════════════════════════════════════════
     HEADER ROW 1 — For BIR Use | Seal+Gov | empty
     ════════════════════════════════════════════ */
  const R1H=40;
  const birW=56, rightW1=75;
  const centerW=TW-birW-rightW1;

  box(ML,Y,birW,R1H);
  txt('For BIR   BCS/',ML+3,Y+9,5.5);
  txt('Use Only',ML+3,Y+16,5.5);
  txt('Item:',ML+3,Y+23,5.5);

  box(ML+birW,Y,centerW,R1H);
  // Real BIR seal image
  const sealSz=32;
  const sealX=ML+birW+8, sealY=Y+(R1H-sealSz)/2;
  page.drawImage(sealImg,{x:sealX,y:H-sealY-sealSz,width:sealSz,height:sealSz});
  const govX=sealX+sealSz+6;
  txt('Republic of the Philippines',govX,Y+11,6.5);
  txt('Department of Finance',govX,Y+19,7.5,helvB);
  txt('Bureau of Internal Revenue',govX,Y+27,7.5,helvB);

  box(ML+birW+centerW,Y,rightW1,R1H);
  Y+=R1H;

  /* ════════════════════════════════════════════
     HEADER ROW 2 — Form No. | Title | Barcode
     ════════════════════════════════════════════ */
  const R2H=48;
  const formW=86, barcodeW=78;
  const titleW=TW-formW-barcodeW;

  box(ML,Y,formW,R2H);
  txt('BIR Form No.',ML+3,Y+8,6);
  txt('2307',ML+3,Y+30,26,helvB);
  txt('January 2018 (ENCS)',ML+3,Y+40,5.5);

  box(ML+formW,Y,titleW,R2H);
  txt('Certificate of Creditable Tax',ML+formW+titleW/2,Y+18,15,helvB,BK,{align:'center'});
  txt('Withheld at Source',ML+formW+titleW/2,Y+34,15,helvB,BK,{align:'center'});

  box(ML+formW+titleW,Y,barcodeW,R2H);
  // Real barcode image
  page.drawImage(barcodeImg,{x:ML+formW+titleW+3,y:H-Y-R2H+10,width:barcodeW-6,height:24});
  txt('2307 01/18ENCS',ML+formW+titleW+barcodeW/2,Y+40,5,helv,BK,{align:'center'});
  Y+=R2H;

  /* ── INSTRUCTION ── */
  const IH=9;
  box(ML,Y,TW,IH);
  txt('Fill in all applicable spaces. Mark all appropriate boxes with an "X".',ML+3,Y+6.5,6);
  Y+=IH;

  /* ════════════════════════════════════════════
     FIELD 1 — For the Period
     ════════════════════════════════════════════ */
  const FN=14; // narrow field number column
  const F1H=13;
  box(ML,Y,FN,F1H);
  txt('1',ML+FN/2,Y+9,7,helvB,BK,{align:'center'});
  box(ML+FN,Y,TW-FN,F1H);
  txt('For the Period',ML+FN+3,Y+9,7);
  txt('From',ML+FN+65,Y+9,7,helvB);
  datebox(`${Q_STARTS[q-1]}/${y}`,ML+FN+83,Y+2);
  txt('(MM/DD/YYYY)',ML+FN+170,Y+8,5.5,helv,DGY);
  txt('To',ML+FN+215,Y+9,7,helvB);
  datebox(`${Q_ENDS[q-1]}/${y}`,ML+FN+225,Y+2);
  txt('(MM/DD/YYYY)',ML+FN+313,Y+8,5.5,helv,DGY);
  Y+=F1H;

  /* ── PART I HEADER ── */
  hdr('Part I – Payee Information',ML,Y,TW);
  Y+=11;

  /* ── FIELD 2: Payee TIN (2 rows = 24pt) ── */
  const F2H=24;
  box(ML,Y,FN,F2H);
  txt('2',ML+FN/2,Y+14,7,helvB,BK,{align:'center'});
  box(ML+FN,Y,TW-FN,F2H);
  txt('Taxpayer Identification Number (TIN)',ML+FN+3,Y+8,6.5,helv,LGY);
  tin(String(cert.supplier_tin??''),ML+FN+3,Y+13);
  Y+=F2H;

  /* ── FIELD 3: Payee Name (3 rows = 31pt) ── */
  const F3H=31;
  box(ML,Y,FN,F3H);
  txt('3',ML+FN/2,Y+17,7,helvB,BK,{align:'center'});
  box(ML+FN,Y,TW-FN,F3H);
  txt('Payee\'s Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)',
    ML+FN+3,Y+8,5.5,helvI,DGY,{maxW:TW-FN-6});
  box(ML+FN+3,Y+11,TW-FN-6,17);
  txt(String(cert.supplier_name??''),ML+FN+5,Y+23,8,helvB,BK,{maxW:TW-FN-12});
  Y+=F3H;

  /* ── FIELD 4: Payee Address (3 rows = 31pt) ── */
  const F4H=31;
  const ZIPDIV=50; // width reserved for ZIP section
  const addrW=TW-FN-ZIPDIV;
  box(ML,Y,FN,F4H);
  txt('4',ML+FN/2,Y+17,7,helvB,BK,{align:'center'});
  box(ML+FN,Y,addrW,F4H);
  txt('Registered Address',ML+FN+3,Y+8,6.5,helv,LGY);
  box(ML+FN+3,Y+11,addrW-6,17);
  if(cert.supplier_address) txt(String(cert.supplier_address),ML+FN+5,Y+23,7,helv,BK,{maxW:addrW-10});
  box(ML+FN+addrW,Y,ZIPDIV,F4H);
  txt('4A ZIP Code',ML+FN+addrW+3,Y+8,6,helv,LGY);
  zipbox(ML+FN+addrW+4,Y+13);
  Y+=F4H;

  /* ── FIELD 5: Foreign Address (2 rows = 22pt) ── */
  const F5H=22;
  box(ML,Y,FN,F5H);
  txt('5',ML+FN/2,Y+13,7,helvB,BK,{align:'center'});
  box(ML+FN,Y,TW-FN,F5H);
  txt('Foreign Address, if applicable',ML+FN+3,Y+8,6.5,helvI,DGY);
  box(ML+FN+3,Y+11,TW-FN-6,9);
  Y+=F5H;

  /* BIR privacy note row */
  const NH=9;
  box(ML,Y,TW,NH);
  txt('*NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)',
    ML+TW-3,Y+6.5,5.5,helv,DGY,{align:'right'});
  Y+=NH;

  /* ── PART II HEADER ── */
  hdr('Part II – Payor Information',ML,Y,TW);
  Y+=11;

  /* ── FIELD 6: Payor TIN ── */
  box(ML,Y,FN,F2H);
  txt('6',ML+FN/2,Y+14,7,helvB,BK,{align:'center'});
  box(ML+FN,Y,TW-FN,F2H);
  txt('Taxpayer Identification Number (TIN)',ML+FN+3,Y+8,6.5,helv,LGY);
  tin(String(cert.company_tin??''),ML+FN+3,Y+13);
  Y+=F2H;

  /* ── FIELD 7: Payor Name ── */
  box(ML,Y,FN,F3H);
  txt('7',ML+FN/2,Y+17,7,helvB,BK,{align:'center'});
  box(ML+FN,Y,TW-FN,F3H);
  txt('Payor\'s Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)',
    ML+FN+3,Y+8,5.5,helvI,DGY,{maxW:TW-FN-6});
  box(ML+FN+3,Y+11,TW-FN-6,17);
  txt(String(cert.company_name??''),ML+FN+5,Y+23,8,helvB,BK,{maxW:TW-FN-12});
  Y+=F3H;

  /* ── FIELD 8: Payor Address ── */
  box(ML,Y,FN,F4H);
  txt('8',ML+FN/2,Y+17,7,helvB,BK,{align:'center'});
  box(ML+FN,Y,addrW,F4H);
  txt('Registered Address',ML+FN+3,Y+8,6.5,helv,LGY);
  box(ML+FN+3,Y+11,addrW-6,17);
  if(cert.company_address) txt(String(cert.company_address),ML+FN+5,Y+23,7,helv,BK,{maxW:addrW-10});
  box(ML+FN+addrW,Y,ZIPDIV,F4H);
  txt('8A ZIP Code',ML+FN+addrW+3,Y+8,6,helv,LGY);
  zipbox(ML+FN+addrW+4,Y+13);
  Y+=F4H;

  /* ════════════════════════════════════════════
     PART III — Details
     ════════════════════════════════════════════ */
  hdr('Part III – Details of Monthly Income Payments and Taxes Withheld',ML,Y,TW);
  Y+=11;

  /* Table column widths (proportional to official Excel: A-K, L-N, O-S, T-X, Y-AC, AD-AH, AI-AN) */
  const c1=TW*0.275; // Description
  const c2=TW*0.075; // ATC
  const c3=TW*0.125; // Month 1
  const c4=TW*0.125; // Month 2
  const c5=TW*0.125; // Month 3
  const c6=TW*0.125; // Total
  const c7=TW*0.150; // Tax Withheld
  const colX=[ML, ML+c1, ML+c1+c2, ML+c1+c2+c3, ML+c1+c2+c3+c4, ML+c1+c2+c3+c4+c5, ML+c1+c2+c3+c4+c5+c6];

  /* Table header — row 35 (10pt) + rows 36-37 (21pt) */
  const TH1=10, TH2=21;
  // Row 35: main labels
  box(colX[0],Y,c1,TH1+TH2,GY);
  txt('Income Payments Subject to Expanded',colX[0]+c1/2,Y+10,5.5,helvB,BK,{align:'center'});
  txt('Withholding Tax',colX[0]+c1/2,Y+17,5.5,helvB,BK,{align:'center'});
  box(colX[1],Y,c2,TH1+TH2,GY);
  txt('ATC',colX[1]+c2/2,Y+(TH1+TH2)/2+3,6,helvB,BK,{align:'center'});
  box(colX[2],Y,c3+c4+c5,TH1,GY);
  txt('AMOUNT OF INCOME PAYMENTS',colX[2]+(c3+c4+c5)/2,Y+7,6,helvB,BK,{align:'center'});
  box(colX[5],Y,c6,TH1+TH2,GY);
  txt('Total',colX[5]+c6/2,Y+(TH1+TH2)/2+3,6,helvB,BK,{align:'center'});
  box(colX[6],Y,c7,TH1+TH2,GY);
  txt('Tax Withheld for the',colX[6]+c7/2,Y+10,5.5,helvB,BK,{align:'center'});
  txt('Quarter',colX[6]+c7/2,Y+17,5.5,helvB,BK,{align:'center'});
  Y+=TH1;

  // Rows 36-37: month sub-headers (no month names — matches official form)
  const cols345=[c3,c4,c5];
  for(let i=0;i<3;i++){
    box(colX[2+i],Y,cols345[i],TH2,GY);
    txt(['1st','2nd','3rd'][i]+' Month of the',colX[2+i]+cols345[i]/2,Y+8,5.5,helvB,BK,{align:'center'});
    txt('Quarter',colX[2+i]+cols345[i]/2,Y+15,5.5,helvB,BK,{align:'center'});
  }
  Y+=TH2;

  /* ── SECTION A: 10 data rows (rows 38-47), 15pt each ── */
  const DR=15;
  const colW=[c1,c2,c3,c4,c5,c6,c7];

  // Row 38: data row
  for(let i=0;i<7;i++) box(colX[i],Y,colW[i],DR);
  txt(String(cert.atc_description??'Income payment subject to EWT'),colX[0]+2,Y+8,5.5,helv,BK,{maxW:c1-4});
  txt(String(cert.bir_atc_code??''),colX[1]+c2/2,Y+10,6,helvB,BK,{align:'center'});
  am.forEach((a,i)=>{if(a>0)txt(fmt(a),colX[2+i]+cols345[i]-2,Y+10,6,helv,BK,{align:'right'});});
  txt(fmt(cert.taxable_amount as number),colX[5]+c6-2,Y+10,6,helvB,BK,{align:'right'});
  txt(fmt(cert.amount_withheld as number),colX[6]+c7-2,Y+10,6,helvB,BK,{align:'right'});
  txt(`${String(cert.internal_no)} / ${String(cert.bill_no)}`,colX[0]+2,Y+DR-2,5,helv,DGY,{maxW:c1-4});
  Y+=DR;

  // Rows 39-47: 9 blank rows
  for(let r=0;r<9;r++){
    for(let i=0;i<7;i++) box(colX[i],Y,colW[i],DR);
    Y+=DR;
  }

  /* ── TOTAL A (row 48) ── */
  for(let i=0;i<7;i++) box(colX[i],Y,colW[i],DR,GY2);
  txt('Total',colX[0]+3,Y+10,6.5,helvB);
  am.forEach((a,i)=>{if(a>0)txt(fmt(a),colX[2+i]+cols345[i]-2,Y+10,6,helvB,BK,{align:'right'});});
  txt(fmt(cert.taxable_amount as number),colX[5]+c6-2,Y+10,6,helvB,BK,{align:'right'});
  txt(fmt(cert.amount_withheld as number),colX[6]+c7-2,Y+10,6,helvB,BK,{align:'right'});
  Y+=DR;

  /* ── MONEY PAYMENTS HEADER (rows 49-50, 21pt)
     Gray only in description column; other columns are plain data cells ── */
  const MPH=21;
  box(colX[0],Y,c1,MPH,GY);
  txt('Money Payments Subject to Withholding',colX[0]+2,Y+9,5.5,helvB,BK,{maxW:c1-4});
  txt('of Business Tax (Government & Private)',colX[0]+2,Y+16,5.5,helvB,BK,{maxW:c1-4});
  box(colX[1],Y,c2,MPH);
  for(let i=2;i<7;i++) box(colX[i],Y,colW[i],MPH);
  Y+=MPH;

  /* ── SECTION B: 10 blank rows (rows 51-60), 15pt each ── */
  for(let r=0;r<10;r++){
    for(let i=0;i<7;i++) box(colX[i],Y,colW[i],DR);
    Y+=DR;
  }

  /* ── TOTAL B (row 61) ── */
  for(let i=0;i<7;i++) box(colX[i],Y,colW[i],DR,GY2);
  txt('Total',colX[0]+3,Y+10,6.5,helvB);
  Y+=DR;

  /* ════════════════════════════════════════════
     DECLARATION (row 62, 40pt)
     ════════════════════════════════════════════ */
  const DECH=40;
  box(ML,Y,TW,DECH);
  const decl='    We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. Further, we give our consent to the processing of our information as contemplated under the *Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.';
  const words=decl.split(' ');
  let l1='',l2='',l3='';
  for(const w of words){
    const t1=l1+(l1?' ':'')+w;
    if(helv.widthOfTextAtSize(t1,6)<TW-6){l1=t1;continue;}
    const t2=l2+(l2?' ':'')+w;
    if(helv.widthOfTextAtSize(t2,6)<TW-6){l2=t2;continue;}
    l3+=(l3?' ':'')+w;
  }
  txt(l1,ML+3,Y+9,6);
  if(l2) txt(l2,ML+3,Y+17,6);
  if(l3) txt(l3,ML+3,Y+25,6);
  Y+=DECH;

  /* ════════════════════════════════════════════
     SIGNATURE BLOCK helper
     ════════════════════════════════════════════ */
  function sigBlock(label:string,yStart:number):number {
    const SPACE=29, LBL=10, IND=10, ACCRED=22;
    // Empty signature space
    box(ML,yStart,TW,SPACE+LBL+IND);
    ln(ML+70,yStart+SPACE,ML+TW-70,yStart+SPACE);
    txt(label,(ML+ML+TW)/2,yStart+SPACE+8,6,helv,BK,{align:'center'});
    txt('(Indicate Title/Designation and TIN)',(ML+ML+TW)/2,yStart+SPACE+16,5.5,helv,DGY,{align:'center'});
    let ay=yStart+SPACE+LBL+IND;
    // Accreditation row
    box(ML,ay,TW,ACCRED);
    const m1=ML+TW*0.36, m2=ML+TW*0.68;
    ln(m1,ay,m1,ay+ACCRED);
    ln(m2,ay,m2,ay+ACCRED);
    txt('Tax Agent Accreditation No./',ML+3,ay+7,6);
    txt("Attorney's Roll No. (if applicable)",ML+3,ay+14,6);
    txt('Date of Issue',m1+3,ay+5,6);
    txt('(MM/DD/YYYY)',m1+3,ay+19,5,helv,rgb(0.5,0.5,0.5));
    const db1=m1+5;
    for(let j=0;j<8;j++){
      const jx=db1+j*9+(j>1?5:0)+(j>3?5:0);
      box(jx,ay+7,8,9);
      if(j===2||j===4) txt('/',jx-4,ay+14,7);
    }
    txt('Date of Expiry',m2+3,ay+5,6);
    txt('(MM/DD/YYYY)',m2+3,ay+19,5,helv,rgb(0.5,0.5,0.5));
    const db2=m2+5;
    for(let j=0;j<8;j++){
      const jx=db2+j*9+(j>1?5:0)+(j>3?5:0);
      box(jx,ay+7,8,9);
      if(j===2||j===4) txt('/',jx-4,ay+14,7);
    }
    return ay+ACCRED;
  }

  Y=sigBlock('Signature over Printed Name of Payor/Payor\'s Authorized Representative/Tax Agent',Y);

  /* CONFORME */
  box(ML,Y,TW,11,GY);
  txt('CONFORME:',(ML+ML+TW)/2,Y+8,8,helvB,BK,{align:'center'});
  Y+=11;

  Y=sigBlock('Signature over Printed Name of Payee/Payee\'s Authorized Representative/Tax Agent',Y);

  /* ── FOOTNOTE ── */
  box(ML,Y,TW,11);
  txt('*NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)',ML+3,Y+7,5.5);

  const pdfBytes=await pdf.save();
  return new Response(Buffer.from(pdfBytes),{
    headers:{
      'Content-Type':'application/pdf',
      'Content-Disposition':`inline; filename="BIR-2307-${String(cert.cert_no)}.pdf"`,
    },
  });
}
