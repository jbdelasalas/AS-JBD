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

const KIND_LABEL: Record<LabelEntity, string> = { bin: 'BIN', box: 'BOX', pallet: 'PALLET' };

export function QrLabel({ row }: { row: LabelRow }) {
  // 70mm x 40mm sticker: QR on the left, human-readable identity on the right,
  // so a picker can read the bin without scanning.
  const svg = useMemo(() => qrSvg(row.code, 108), [row.code]);
  return (
    <div className="qr-label flex items-center gap-3 rounded border border-slate-300 bg-white p-2">
      <div
        className="shrink-0"
        style={{ width: 108, height: 108 }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {KIND_LABEL[row.entity_type]}
        </p>
        <p className="truncate text-lg font-bold leading-tight text-black" title={row.title}>{row.title}</p>
        {row.subtitle && <p className="truncate text-xs text-slate-700">{row.subtitle}</p>}
        {row.detail && <p className="truncate text-xs text-slate-500">{row.detail}</p>}
        <p className="mt-1 break-all font-mono text-[8px] leading-tight text-slate-400">{row.code}</p>
      </div>
    </div>
  );
}

/** Print rules: hide the app chrome and `.qr-screen-only`, lay `#print-sheet` out two-up. */
export const LABEL_PRINT_CSS = `
  @media print {
    html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body, main { background: #fff !important; height: auto !important; overflow: visible !important; }
    .h-screen { height: auto !important; }
    .overflow-hidden, .overflow-y-auto, .overflow-x-auto { overflow: visible !important; }
    aside, header { display: none !important; }
    main { padding: 0 !important; }
    .qr-screen-only { display: none !important; }
    #print-sheet {
      display: grid !important;
      grid-template-columns: 1fr 1fr;
      gap: 4mm;
    }
    .qr-label { break-inside: avoid; page-break-inside: avoid; color: #000 !important; }
    @page { margin: 8mm; }
  }
`;
