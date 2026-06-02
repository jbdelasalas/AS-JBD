export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { PDFDocument, rgb, StandardFonts, LineCapStyle } from 'pdf-lib';

const Q_STARTS = ['01/01', '04/01', '07/01', '10/01'];
const Q_ENDS   = ['03/31', '06/30', '09/30', '12/31'];
const Q_MONTHS: Record<number, [string,string,string]> = {
  1: ['January','February','March'],
  2: ['April','May','June'],
  3: ['July','August','September'],
  4: ['October','November','December'],
};

function monthPos(dateStr: string, q: number): 0|1|2 {
  const m = new Date(dateStr).getMonth() + 1;
  return Math.max(0, Math.min(2, m - (q-1)*3 - 1)) as 0|1|2;
}

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(
    `SELECT wc.*,
            b.bill_no, b.internal_no, b.bill_date,
            s.name AS supplier_name, s.tin AS supplier_tin, s.address AS supplier_address,
            co.name AS company_name, co.bir_tin AS company_tin,
            co.registered_address AS company_address
       FROM wht_certificates wc
       JOIN bills b    ON b.id    = wc.bill_id
       JOIN suppliers s ON s.id   = wc.supplier_id
       JOIN companies co ON co.id = wc.company_id
      WHERE wc.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return new Response('Not found', { status: 404 });
  const cert = rows[0] as Record<string, unknown>;

  const q  = Number(cert.period_quarter);
  const y  = Number(cert.period_year);
  const months = Q_MONTHS[q];
  const pos = monthPos(String(cert.bill_date), q);
  const am: [number,number,number] = [0,0,0];
  am[pos] = Number(cert.taxable_amount);

  /* ─── Build PDF ─── */
  const pdf  = await PDFDocument.create();
  // Long bond paper (8.5 × 13 inches) — standard PH BIR form size
  const page = pdf.addPage([612, 936]);
  const W = 612, H = 936;

  const helv  = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);

  const BK  = rgb(0,0,0);
  const GY  = rgb(0.82,0.82,0.82);  // section header grey
  const GY2 = rgb(0.90,0.90,0.90);  // total row grey
  const WH  = rgb(1,1,1);

  /* margins */
  const ML = 17, MR = 17, MT = 14;

  /* helpers */
  function line(x1:number,y1:number,x2:number,y2:number,w=0.5) {
    page.drawLine({ start:{x:x1,y:H-y1}, end:{x:x2,y:H-y2}, thickness:w, color:BK, lineCap:LineCapStyle.Butt });
  }
  function rect(x:number,y:number,w:number,h:number,fill?:ReturnType<typeof rgb>,stroke=true) {
    if (fill) page.drawRectangle({ x, y:H-y-h, width:w, height:h, color:fill, borderWidth:stroke?0.5:0, borderColor:stroke?BK:undefined });
    else page.drawRectangle({ x, y:H-y-h, width:w, height:h, borderWidth:0.5, borderColor:BK });
  }
  function text(t:string,x:number,y:number,size:number,font=helv,color=BK,opts:{align?:'center'|'right',maxWidth?:number}={}) {
    if (!t) return;
    let px = x;
    if (opts.align==='center') px = x - font.widthOfTextAtSize(t,size)/2;
    if (opts.align==='right')  px = x - font.widthOfTextAtSize(t,size);
    if (opts.maxWidth) {
      // truncate text to fit
      while (t.length > 1 && font.widthOfTextAtSize(t,size) > opts.maxWidth) t = t.slice(0,-1);
    }
    page.drawText(t, { x:px, y:H-y, size, font, color });
  }
  function charBoxes(val:string,x:number,y:number,count:number,bw=8.5,bh=9) {
    const chars = val.replace(/\D/g,'').padEnd(count,' ').split('');
    let cx = x;
    for (let i=0;i<count;i++) {
      rect(cx,y,bw,bh);
      if (chars[i]?.trim()) text(chars[i],cx+bw/2,y+bh-2,6,helv,BK,{align:'center'});
      cx += bw + 0.5;
    }
  }
  function tinBoxes(tin:string|null,x:number,y:number) {
    const digits = (tin??'').replace(/\D/g,'');
    charBoxes(digits,x,y,3); x+=3*9; text('-',x+1,y+7,7); x+=8;
    charBoxes(digits.slice(3),x,y,3); x+=3*9; text('-',x+1,y+7,7); x+=8;
    charBoxes(digits.slice(6),x,y,3); x+=3*9; text('-',x+1,y+7,7); x+=8;
    charBoxes(digits.slice(9),x,y,5);
  }
  function dateBoxes(dateStr:string,x:number,y:number) {
    const [mm='',dd='',yyyy=''] = dateStr.split('/');
    charBoxes(mm,x,y,2); x+=2*9+2; text('/',x-1,y+7,7); x+=4;
    charBoxes(dd,x,y,2); x+=2*9+2; text('/',x-1,y+7,7); x+=4;
    charBoxes(yyyy,x,y,4);
  }
  function zipBoxes(x:number,y:number) {
    for(let i=0;i<4;i++){ rect(x+i*9.5,y,8.5,9); }
  }
  function hdrRow(label:string,x:number,y:number,w:number,h=11) {
    rect(x,y,w,h,GY);
    text(label,x+w/2,y+h-3,7,helvB,BK,{align:'center'});
  }
  function dataCell(x:number,y:number,w:number,h:number,fill?:ReturnType<typeof rgb>) {
    rect(x,y,w,h,fill);
  }

  /* ══════════════════════════════════════
     LAYOUT — top to bottom
     ══════════════════════════════════════ */
  let Y = MT;  // current Y position from top

  /* ── ROW 1: For BIR | Seal area | empty right ── */
  const R1H = 38;
  rect(ML,Y,52,R1H);
  text('For BIR   BCS/', ML+3, Y+8, 6);
  text('Use Only',        ML+3, Y+15,6);
  text('Item:',           ML+3, Y+22,6);

  // center content
  rect(ML+52,Y,W-ML-MR-52-70,R1H);
  // Seal circle
  const cx=ML+52+(W-ML-MR-52-70)/2-40, cy=H-(Y+R1H/2);
  page.drawCircle({ x:cx, y:cy, size:13, borderWidth:0.7, borderColor:BK });
  text('PH',   cx-6,   Y+R1H/2-3, 5, helvB);
  text('SEAL', cx-9,   Y+R1H/2+3, 4);
  text('Republic of the Philippines',  cx+20, Y+9,  6.5, helv);
  text('Department of Finance',        cx+20, Y+16, 7.5, helvB);
  text('Bureau of Internal Revenue',  cx+20, Y+23, 7.5, helvB);

  rect(W-MR-70,Y,70,R1H);
  Y += R1H;

  /* ── ROW 2: Form No. | TITLE | Barcode ── */
  const R2H = 46;
  rect(ML,Y,78,R2H);
  text('BIR Form No.',ML+3,Y+7,6);
  text('2307',        ML+3,Y+28,24,helvB);
  text('January 2018 (ENCS)',ML+3,Y+38,5.5);

  // Title cell
  rect(ML+78,Y,W-ML-MR-78-70,R2H);
  text('Certificate of Creditable Tax', ML+78+(W-ML-MR-78-70)/2, Y+18, 14, helvB, BK, {align:'center'});
  text('Withheld at Source',             ML+78+(W-ML-MR-78-70)/2, Y+33, 14, helvB, BK, {align:'center'});

  // Barcode
  rect(W-MR-70,Y,70,R2H);
  // draw barcode stripes
  let bx=W-MR-68;
  for(let i=0;i<28;i++){
    const bw=i%3===0?2:1;
    rect(bx,Y+4,bw,22,BK,false);
    bx+=bw+(i%2===0?1:2);
  }
  text('2307 01/18ENCS',W-MR-35,Y+32,5,helv,BK,{align:'center'});
  Y += R2H;

  /* ── INSTRUCTION ── */
  const IH = 9;
  rect(ML,Y,W-ML-MR,IH);
  text('Fill in all applicable spaces. Mark all appropriate boxes with an "X".', ML+3,Y+6.5,6);
  Y += IH;

  /* ── FIELD 1: For the Period ── */
  const F1H = 14;
  rect(ML,Y,W-ML-MR,F1H);
  rect(ML,Y,14,F1H);  // number cell
  text('1',ML+7,Y+9,7,helvB,BK,{align:'center'});
  line(ML+14,Y,ML+14,Y+F1H);
  text('For the Period', ML+17,Y+9,7);
  text('From', ML+55,Y+9,7,helvB);
  dateBoxes(`${Q_STARTS[q-1]}/${y}`, ML+75, Y+3);
  text('(MM/DD/YYYY)',ML+163,Y+8,5.5,helv,rgb(0.4,0.4,0.4));
  text('To',ML+205,Y+9,7,helvB);
  dateBoxes(`${Q_ENDS[q-1]}/${y}`, ML+215, Y+3);
  text('(MM/DD/YYYY)',ML+303,Y+8,5.5,helv,rgb(0.4,0.4,0.4));
  Y += F1H;

  /* ── PART I HEADER ── */
  hdrRow('Part I – Payee Information',ML,Y,W-ML-MR);
  Y += 11;

  /* ── FIELD 2: Payee TIN ── */
  const SPLIT=W*0.45; // 45% left (number), 55% right (content)
  const leftW=SPLIT-ML, rightW=W-ML-MR-leftW;
  const F2H = 20;
  rect(ML,Y,leftW,F2H);
  text('2',ML+leftW/2,Y+12,8,helvB,BK,{align:'center'});
  rect(ML+leftW,Y,rightW,F2H);
  text('Taxpayer Identification Number (TIN)',ML+leftW+3,Y+7,6.5,helv,rgb(0.3,0.3,0.3));
  tinBoxes(String(cert.supplier_tin??''), ML+leftW+3, Y+10);
  Y += F2H;

  /* ── FIELD 3: Payee Name ── */
  const F3H = 25;
  rect(ML,Y,leftW,F3H);
  text('3',ML+leftW/2,Y+14,8,helvB,BK,{align:'center'});
  rect(ML+leftW,Y,rightW,F3H);
  text('Payee\'s Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)',ML+leftW+3,Y+7,5.5,helv,rgb(0.4,0.4,0.4),{maxWidth:rightW-6});
  // name box
  rect(ML+leftW+3,Y+9,rightW-6,13);
  text(String(cert.supplier_name??''),ML+leftW+5,Y+19,8,helvB,BK,{maxWidth:rightW-10});
  Y += F3H;

  /* ── FIELD 4: Payee Address ── */
  const F4H = 25;
  rect(ML,Y,leftW,F4H);
  text('4',ML+leftW/2,Y+14,8,helvB,BK,{align:'center'});
  rect(ML+leftW,Y,rightW,F4H);
  const addrW = rightW-55;
  text('Registered Address',ML+leftW+3,Y+7,6.5,helv,rgb(0.3,0.3,0.3));
  rect(ML+leftW+3,Y+9,addrW,13);
  if(cert.supplier_address) text(String(cert.supplier_address),ML+leftW+5,Y+19,7,helv,BK,{maxWidth:addrW-4});
  // ZIP
  line(ML+leftW+addrW+6,Y,ML+leftW+addrW+6,Y+F4H);
  text('4A ZIP Code',ML+leftW+addrW+10,Y+7,6,helv,rgb(0.3,0.3,0.3));
  zipBoxes(ML+leftW+addrW+10,Y+9);
  Y += F4H;

  /* ── FIELD 5: Foreign Address ── */
  const F5H = 22;
  rect(ML,Y,leftW,F5H);
  text('5',ML+leftW/2,Y+12,8,helvB,BK,{align:'center'});
  rect(ML+leftW,Y,rightW,F5H);
  text('Foreign Address, if applicable',ML+leftW+3,Y+7,6.5,helv,rgb(0.3,0.3,0.3));
  rect(ML+leftW+3,Y+9,rightW-6,10);
  Y += F5H;

  /* BIR note */
  const NOTH=9;
  rect(ML,Y,W-ML-MR,NOTH);
  text('*NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)',W-MR-3,Y+6.5,5.5,helv,rgb(0.4,0.4,0.4),{align:'right'});
  Y += NOTH;

  /* ── PART II HEADER ── */
  hdrRow('Part II – Payor Information',ML,Y,W-ML-MR);
  Y += 11;

  /* ── FIELD 6: Payor TIN ── */
  rect(ML,Y,leftW,F2H);
  text('6',ML+leftW/2,Y+12,8,helvB,BK,{align:'center'});
  rect(ML+leftW,Y,rightW,F2H);
  text('Taxpayer Identification Number (TIN)',ML+leftW+3,Y+7,6.5,helv,rgb(0.3,0.3,0.3));
  tinBoxes(String(cert.company_tin??''), ML+leftW+3, Y+10);
  Y += F2H;

  /* ── FIELD 7: Payor Name ── */
  rect(ML,Y,leftW,F3H);
  text('7',ML+leftW/2,Y+14,8,helvB,BK,{align:'center'});
  rect(ML+leftW,Y,rightW,F3H);
  text('Payor\'s Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)',ML+leftW+3,Y+7,5.5,helv,rgb(0.4,0.4,0.4),{maxWidth:rightW-6});
  rect(ML+leftW+3,Y+9,rightW-6,13);
  text(String(cert.company_name??''),ML+leftW+5,Y+19,8,helvB,BK,{maxWidth:rightW-10});
  Y += F3H;

  /* ── FIELD 8: Payor Address ── */
  rect(ML,Y,leftW,F4H);
  text('8',ML+leftW/2,Y+14,8,helvB,BK,{align:'center'});
  rect(ML+leftW,Y,rightW,F4H);
  text('Registered Address',ML+leftW+3,Y+7,6.5,helv,rgb(0.3,0.3,0.3));
  rect(ML+leftW+3,Y+9,addrW,13);
  if(cert.company_address) text(String(cert.company_address),ML+leftW+5,Y+19,7,helv,BK,{maxWidth:addrW-4});
  line(ML+leftW+addrW+6,Y,ML+leftW+addrW+6,Y+F4H);
  text('8A ZIP Code',ML+leftW+addrW+10,Y+7,6,helv,rgb(0.3,0.3,0.3));
  zipBoxes(ML+leftW+addrW+10,Y+9);
  Y += F4H;

  /* ── PART III HEADER ── */
  hdrRow('Part III – Details of Monthly Income Payments and Taxes Withheld',ML,Y,W-ML-MR);
  Y += 11;

  /* ── TABLE HEADER ── */
  const TW = W-ML-MR;
  const c1=TW*0.30, c2=TW*0.07, c3=TW*0.13, c4=TW*0.13, c5=TW*0.13, c6=TW*0.11, c7=TW*0.13;
  const colX = [ML, ML+c1, ML+c1+c2, ML+c1+c2+c3, ML+c1+c2+c3+c4, ML+c1+c2+c3+c4+c5, ML+c1+c2+c3+c4+c5+c6];
  const TH1 = 14, TH2 = 18;

  // Top header row (AMOUNT spans 3 cols)
  rect(colX[0],Y,c1,TH1+TH2,GY); // Income - spans 2 header rows
  text('Income Payments Subject to Expanded',colX[0]+c1/2,Y+9, 6,helvB,BK,{align:'center'});
  text('Withholding Tax',colX[0]+c1/2,Y+16,6,helvB,BK,{align:'center'});
  rect(colX[1],Y,c2,TH1+TH2,GY); // ATC
  text('ATC',colX[1]+c2/2,Y+(TH1+TH2)/2+3,6,helvB,BK,{align:'center'});
  rect(colX[2],Y,c3+c4+c5,TH1,GY); // AMOUNT header
  text('AMOUNT OF INCOME PAYMENTS',colX[2]+(c3+c4+c5)/2,Y+9,6,helvB,BK,{align:'center'});
  rect(colX[5],Y,c6,TH1+TH2,GY); // Total
  text('Total',colX[5]+c6/2,Y+(TH1+TH2)/2+3,6,helvB,BK,{align:'center'});
  rect(colX[6],Y,c7,TH1+TH2,GY); // Tax withheld
  text('Tax Withheld for the',colX[6]+c7/2,Y+9,5.5,helvB,BK,{align:'center'});
  text('Quarter',colX[6]+c7/2,Y+17,5.5,helvB,BK,{align:'center'});
  Y += TH1;

  // Sub-header row
  for(let i=0;i<3;i++){
    rect(colX[2+i],Y,c3,TH2,GY);
    text(['1st','2nd','3rd'][i]+' Month of the',colX[2+i]+c3/2,Y+7,5.5,helvB,BK,{align:'center'});
    text('Quarter',colX[2+i]+c3/2,Y+13,5.5,helvB,BK,{align:'center'});
    text('('+months[i]+')',colX[2+i]+c3/2,Y+19,5,helv,BK,{align:'center'});
  }
  Y += TH2;

  /* ── DATA ROW ── */
  const DR = 18;
  for(let i=0;i<7;i++) dataCell(colX[i],Y,[c1,c2,c3,c4,c5,c6,c7][i],DR);
  // description
  text(String(cert.atc_description??'Income payment subject to EWT'),colX[0]+2,Y+8,6,helv,BK,{maxWidth:c1-4});
  text(String(cert.bir_atc_code??''),colX[1]+c2/2,Y+11,6,helvB,BK,{align:'center'});
  am.forEach((a,i)=>{ if(a>0) text(fmt(a),colX[2+i]+c3-2,Y+11,6.5,helv,BK,{align:'right'}); });
  text(fmt(cert.taxable_amount as number),colX[5]+c6-2,Y+11,6.5,helvB,BK,{align:'right'});
  text(fmt(cert.amount_withheld as number),colX[6]+c7-2,Y+11,6.5,helvB,BK,{align:'right'});

  // bill ref small text
  text(`${String(cert.internal_no)} / ${String(cert.bill_no)}`,colX[0]+2,Y+15,5,helv,rgb(0.4,0.4,0.4),{maxWidth:c1-4});
  Y += DR;

  /* ── BLANK ROWS (9) ── */
  for(let r=0;r<9;r++){
    for(let i=0;i<7;i++) dataCell(colX[i],Y,[c1,c2,c3,c4,c5,c6,c7][i],12);
    Y += 12;
  }

  /* ── TOTAL ROW A ── */
  rect(colX[0],Y,c1+c2,12,GY2);
  text('Total',colX[0]+3,Y+8,6.5,helvB);
  for(let i=2;i<7;i++) dataCell(colX[i],Y,[c1,c2,c3,c4,c5,c6,c7][i],12,GY2);
  am.forEach((a,i)=>{ if(a>0) text(fmt(a),colX[2+i]+c3-2,Y+8,6.5,helvB,BK,{align:'right'}); });
  text(fmt(cert.taxable_amount as number),colX[5]+c6-2,Y+8,6.5,helvB,BK,{align:'right'});
  text(fmt(cert.amount_withheld as number),colX[6]+c7-2,Y+8,6.5,helvB,BK,{align:'right'});
  Y += 12;

  /* ── MONEY PAYMENTS HEADER ── */
  rect(ML,Y,W-ML-MR,11,GY);
  text('Money Payments Subject to Withholding of Business Tax (Government & Private)',ML+4,Y+7.5,6.5,helvB);
  Y += 11;

  /* ── BLANK ROWS B (8) ── */
  for(let r=0;r<8;r++){
    for(let i=0;i<7;i++) dataCell(colX[i],Y,[c1,c2,c3,c4,c5,c6,c7][i],12);
    Y += 12;
  }

  /* ── TOTAL ROW B ── */
  rect(colX[0],Y,c1+c2,12,GY2);
  text('Total',colX[0]+3,Y+8,6.5,helvB);
  for(let i=2;i<7;i++) dataCell(colX[i],Y,[c1,c2,c3,c4,c5,c6,c7][i],12,GY2);
  Y += 12;

  /* ── DECLARATION ── */
  const DECH = 24;
  rect(ML,Y,W-ML-MR,DECH);
  const decl = '    We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. Further, we give our consent to the processing of our information as contemplated under the *Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.';
  // wrap text manually
  const words = decl.split(' ');
  let line1='', line2='', line3='';
  for(const w of words){
    const t1=line1+(line1?' ':'')+w;
    if(helv.widthOfTextAtSize(t1,6) < W-ML-MR-6) { line1=t1; continue; }
    const t2=line2+(line2?' ':'')+w;
    if(helv.widthOfTextAtSize(t2,6) < W-ML-MR-6) { line2=t2; continue; }
    line3+=( line3?' ':'')+w;
  }
  text(line1,ML+3,Y+7,6);
  if(line2) text(line2,ML+3,Y+13,6);
  if(line3) text(line3,ML+3,Y+19,6);
  Y += DECH;

  /* ── SIGNATURE 1: PAYOR ── */
  function sigBlock(lbl:string, yStart:number):number {
    const SH=50;
    rect(ML,yStart,W-ML-MR,SH);
    const sigY=yStart+SH-12;
    line(ML+80,sigY,W-MR-80,sigY);
    text(lbl,(ML+W-MR)/2,sigY+7,6.5,helv,BK,{align:'center'});
    text('(Indicate Title/Designation and TIN)',(ML+W-MR)/2,sigY+13,5.5,helv,rgb(0.4,0.4,0.4),{align:'center'});
    return yStart+SH;
  }
  function accredRow(yStart:number):number {
    const AH=22;
    rect(ML,yStart,W-ML-MR,AH);
    const midX=ML+(W-ML-MR)*0.36, mid2X=ML+(W-ML-MR)*0.68;
    line(midX,yStart,midX,yStart+AH);
    line(mid2X,yStart,mid2X,yStart+AH);
    text('Tax Agent Accreditation No./',ML+3,yStart+7,6);
    text("Attorney's Roll No. (if applicable)",ML+3,yStart+14,6);
    // Date of Issue
    text('Date of Issue',midX+3,yStart+5,6);
    const dboxX = midX+5;
    for(let j=0;j<8;j++){
      const jx=dboxX+j*9+(j>1?5:0)+(j>3?5:0);
      rect(jx,yStart+8,8,9);
      if(j===2||j===4) text('/',jx-4,yStart+15,7);
    }
    text('(MM/DD/YYYY)',midX+3,yStart+20,5,helv,rgb(0.5,0.5,0.5));
    // Date of Expiry
    text('Date of Expiry',mid2X+3,yStart+5,6);
    const dbox2X = mid2X+5;
    for(let j=0;j<8;j++){
      const jx=dbox2X+j*9+(j>1?5:0)+(j>3?5:0);
      rect(jx,yStart+8,8,9);
      if(j===2||j===4) text('/',jx-4,yStart+15,7);
    }
    text('(MM/DD/YYYY)',mid2X+3,yStart+20,5,helv,rgb(0.5,0.5,0.5));
    return yStart+AH;
  }

  Y = sigBlock('Signature over Printed Name of Payor/Payor\'s Authorized Representative/Tax Agent', Y);
  Y = accredRow(Y);

  /* CONFORME */
  rect(ML,Y,W-ML-MR,11,GY);
  text('CONFORME:',(ML+W-MR)/2,Y+8,8,helvB,BK,{align:'center'});
  Y += 11;

  /* Signature 2: Payee */
  Y = sigBlock('Signature over Printed Name of Payee/Payee\'s Authorized Representative/Tax Agent', Y);
  Y = accredRow(Y);

  /* Footnote */
  rect(ML,Y,W-ML-MR,9);
  text('*NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)',ML+3,Y+6,5.5);

  /* ── Serialize ── */
  const pdfBytes = await pdf.save();

  return new Response(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="BIR-2307-${String(cert.cert_no)}.pdf"`,
    },
  });
}
