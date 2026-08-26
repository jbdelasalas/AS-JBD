// Builds a label sheet as a PDF sized to the physical stock.
//
// Why a PDF instead of window.print():
//
// Safari on iOS ignores `@page { size }` — it always lays the page out at the
// sheet size picked in the OS print dialog (A4 by default), so a 51x76mm label
// lands small in the corner of a big page. It also draws its own URL/date/page
// footer, which is outside the document and cannot be removed with CSS.
//
// A PDF has neither problem: the page box *is* the label, and iOS prints it at
// true size with no footer. Generating it in the browser also keeps the whole
// flow working offline on the plant floor.
//
// The QR is drawn as vector rectangles rather than a raster image, so it stays
// sharp at any printer resolution and the file stays small.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { encodeQr } from '@/lib/qr';

const MM_TO_PT = 72 / 25.4;
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.6, 0.6, 0.6);

export interface LabelData {
  facility: string;
  product: string;
  lot: string;
  packedText: string;
  weightKg: string;
  heads: string;
  /** Exactly what the on-screen QR encodes, so paper and screen never diverge. */
  qrText: string;
}

/** Longest prefix of `text` that fits `maxWidth`, else the text itself. */
function fitSize(text: string, font: PDFFont, target: number, maxWidth: number, min: number): number {
  let size = target;
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25;
  return size;
}

/** Wrap to at most `maxLines`, shrinking rather than overflowing the label. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !cur) cur = next;
    else { lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.length ? lines : [text];
}

function drawCentred(page: PDFPage, text: string, font: PDFFont, size: number, cx: number, y: number) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: cx - w / 2, y, size, font, color: BLACK });
}

/**
 * One page per copy, each exactly widthMm x heightMm.
 * Returns the PDF bytes.
 */
export async function buildLabelPdf(
  data: LabelData,
  widthMm: number,
  heightMm: number,
  copies: number,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  // Encode once — the same matrix is reused for every copy.
  const modules = encodeQr(data.qrText);
  const n = modules.length;

  const W = widthMm * MM_TO_PT;
  const H = heightMm * MM_TO_PT;
  const pad = Math.min(W, H) * 0.05;
  const inner = W - pad * 2;
  const cx = W / 2;
  const short = Math.min(widthMm, heightMm);

  // Same proportions as the on-screen label, in points.
  const brandSize = short * 0.17;
  const productSize = short * 0.2;
  const metaSize = short * 0.135;

  for (let copy = 0; copy < copies; copy++) {
    const page = doc.addPage([W, H]);
    let y = H - pad;

    // --- Facility, with a rule under it ---
    const bSize = fitSize(data.facility.toUpperCase(), bold, brandSize, inner, brandSize * 0.5);
    const bLines = wrap(data.facility.toUpperCase(), bold, bSize, inner, 2);
    for (const line of bLines) {
      y -= bSize;
      drawCentred(page, line, bold, bSize, cx, y);
      y -= bSize * 0.12;
    }
    y -= pad * 0.3;
    page.drawLine({
      start: { x: pad, y }, end: { x: W - pad, y },
      thickness: Math.max(0.8, H * 0.004), color: BLACK,
    });

    // --- Product ---
    y -= pad * 0.5;
    const pSize = fitSize(data.product, bold, productSize, inner, productSize * 0.45);
    const pLines = wrap(data.product, bold, pSize, inner, 2);
    for (const line of pLines) {
      y -= pSize;
      drawCentred(page, line, bold, pSize, cx, y);
      y -= pSize * 0.12;
    }

    // --- Reserve the bottom block, then give the QR what is left ---
    const rows: [string, string][] = [
      ['PRODUCT', data.product],
      ['LOT', data.lot],
      ['PACKED', data.packedText],
    ];
    const rowH = metaSize * 1.5;
    const totalsLine = data.weightKg || data.heads;
    const totalsH = totalsLine ? productSize * 0.95 * 1.5 + pad * 0.4 : 0;
    const bottomH = rows.length * rowH + totalsH + pad * 0.4;

    const qrAvail = Math.max(0, y - pad - bottomH - pad * 0.4);
    const qrSide = Math.min(inner, qrAvail);

    if (qrSide > 0) {
      const cell = qrSide / (n + 8); // 4-module quiet zone each side
      const qrX = cx - qrSide / 2;
      const qrTop = y - pad * 0.4;
      const originX = qrX + cell * 4;
      const originY = qrTop - qrSide + cell * 4;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!modules[r][c]) continue;
          page.drawRectangle({
            x: originX + c * cell,
            // PDF origin is bottom-left; matrix row 0 is the top.
            y: originY + (n - 1 - r) * cell,
            width: cell * 1.02, // hairline overlap stops seams at low DPI
            height: cell * 1.02,
            color: BLACK,
          });
        }
      }
    }

    // --- Weight / heads, then the meta rows, anchored to the bottom ---
    let by = pad + rows.length * rowH;

    if (totalsLine) {
      const parts: string[] = [];
      if (data.weightKg) parts.push(`${data.weightKg} kg`);
      if (data.heads) parts.push(`${data.heads} head`);
      const text = parts.join('  ·  ');
      const tSize = fitSize(text, bold, productSize * 0.95, inner, productSize * 0.4);
      page.drawLine({
        start: { x: pad, y: by + rowH * 0.55 }, end: { x: W - pad, y: by + rowH * 0.55 },
        thickness: Math.max(0.8, H * 0.004), color: BLACK,
      });
      drawCentred(page, text, bold, tSize, cx, by + rowH * 0.55 + pad * 0.3);
    }

    rows.forEach(([k, v], i) => {
      const lineY = by - i * rowH;
      page.drawLine({
        start: { x: pad, y: lineY }, end: { x: W - pad, y: lineY },
        thickness: i === 0 ? Math.max(0.6, H * 0.003) : 0.4,
        color: i === 0 ? BLACK : GREY,
      });
      const ty = lineY - metaSize * 1.15;
      page.drawText(k, { x: pad, y: ty, size: metaSize, font: bold, color: BLACK });
      const vSize = fitSize(v, reg, metaSize, inner - bold.widthOfTextAtSize(k, metaSize) - pad, metaSize * 0.6);
      const vw = reg.widthOfTextAtSize(v, vSize);
      page.drawText(v, { x: W - pad - vw, y: ty, size: vSize, font: reg, color: BLACK });
    });
  }

  return doc.save();
}
