'use client';

import { useMemo } from 'react';
import { qrSvg } from '@/lib/qr';

// One QR sticker, shared by the Labels page and the put-away print. Rendered as
// inline SVG in the browser, so printing needs no network and no image assets.

export type LabelEntity = 'bin' | 'box' | 'pallet';

export interface LabelRow {
  code: string; entity_type: LabelEntity; entity_id: string;
  title: string; subtitle: string | null; detail: string | null;
  printed_at: string | null;
}

const KIND_LABEL: Record<LabelEntity, string> = { bin: 'BIN', box: 'PACK', pallet: 'PALLET' };

export function QrLabel({ row, logo }: { row: LabelRow; logo?: string | null }) {
  // 2in x 3in portrait sticker: small company logo and kind on top, QR, then
  // the human-readable identity, so a picker can read it without scanning.
  // Sized in inches so the on-screen preview matches the printed label.
  const svg = useMemo(() => qrSvg(row.code, 160), [row.code]);
  return (
    <div className="qr-label flex flex-col items-center overflow-hidden rounded border border-slate-300 bg-white text-center"
      style={{ width: '2in', height: '3in', padding: '0.1in', boxSizing: 'border-box' }}>
      <div className="flex w-full shrink-0 items-center justify-between" style={{ height: '0.32in' }}>
        {logo ? <img src={logo} alt="" style={{ height: '0.3in', maxWidth: '1.1in', objectFit: 'contain' }} /> : <span />}
        <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">{KIND_LABEL[row.entity_type]}</span>
      </div>
      <div className="qr-label-code shrink-0" style={{ width: '1.55in', height: '1.55in' }} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="mt-0.5 flex min-h-0 w-full flex-1 flex-col items-center">
        <p className="line-clamp-2 w-full break-words text-[15px] font-bold leading-tight text-black" title={row.title}>{row.title}</p>
        {row.subtitle && <p className="w-full truncate text-[10px] leading-tight text-slate-700">{row.subtitle}</p>}
        {row.detail && <p className="w-full truncate text-[10px] font-semibold leading-tight text-slate-800">{row.detail}</p>}
        <p className="mt-auto w-full break-all font-mono text-[6px] leading-tight text-slate-400">{row.code}</p>
      </div>
    </div>
  );
}

/**
 * Print rules: hide the app chrome and `.qr-screen-only`, and print
 * `#print-sheet` one 2in x 3in portrait label per page (label-printer roll).
 */
export const LABEL_PRINT_CSS = `
  .qr-label-code svg { width: 100%; height: 100%; }
  @media print {
    html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body, main { background: #fff !important; height: auto !important; overflow: visible !important; }
    .h-screen { height: auto !important; }
    .overflow-hidden, .overflow-y-auto, .overflow-x-auto { overflow: visible !important; }
    aside, header { display: none !important; }
    main, body { padding: 0 !important; margin: 0 !important; }
    .qr-screen-only { display: none !important; }
    #print-sheet { display: block !important; }
    #print-sheet .qr-label {
      border: none !important; border-radius: 0 !important; overflow: hidden !important;
      break-after: page; page-break-after: always; break-inside: avoid; page-break-inside: avoid;
      color: #000 !important;
    }
    #print-sheet .qr-label:last-child { break-after: auto; page-break-after: auto; }
    @page { size: 2in 3in; margin: 0; }
  }
`;
