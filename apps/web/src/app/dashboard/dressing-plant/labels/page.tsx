'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { encodeQr, qrSvg } from '@/lib/qr';
import { buildLabelPdf } from '@/lib/label-pdf';

// Traceability stickers for dressed-chicken output. The QR carries the facility,
// classification, lot and pack date as plain readable text, so a generic phone
// camera resolves it with no app — and the same four facts print beside the code
// in case the sticker is scuffed or the scanner fails.
//
// Classifications come from dp_sizes (see migration 025), the module's managed
// size list, so Production Detail and the label printer share one vocabulary.
//
// Lot numbers are allocated by the server (dp_label_lots, migration 026) and
// are never composed in the browser: a per-device counter cannot tell that
// another station already used -01 today. The number is issued when the
// operator commits to printing, so idle browsing does not burn lot numbers.

interface SizeRow {
  id: string;
  code: string;
  name: string;
  class_group: string | null;
  label_name: string;
}

interface FacilityRow {
  id: string;
  name: string;
  is_default: boolean;
}

interface LotRow {
  id: string;
  lot_no: string;
  seq: number;
  product: string | null;
  facility: string | null;
  copies: number;
  created_at: string;
}

const LS_FACILITY = 'dp.label.facility';
const LS_SIZE = 'dp.label.size';

// ---------------------------------------------------------------------------
// Label stock
// ---------------------------------------------------------------------------
// Everything downstream works in millimetres: @page needs a concrete length (it
// cannot read a CSS variable), and mm is what label stock is actually sold in
// outside the US. Inch sizes below are the exact mm equivalents.

interface Stock {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

const STOCKS: Stock[] = [
  { id: '2x3in',   label: '2 × 3 in (51 × 76 mm)',   widthMm: 50.8,  heightMm: 76.2 },
  { id: '4x6in',   label: '4 × 6 in (102 × 152 mm)', widthMm: 101.6, heightMm: 152.4 },
  { id: '100x150', label: '100 × 150 mm',            widthMm: 100,   heightMm: 150 },
  { id: '60x40',   label: '60 × 40 mm',              widthMm: 60,    heightMm: 40 },
  { id: '40x30',   label: '40 × 30 mm',              widthMm: 40,    heightMm: 30 },
];

const CUSTOM = 'custom';
const DEFAULT_STOCK = STOCKS[0];

// Guard rails: below ~30mm the QR stops resolving on a 203dpi thermal head, and
// nothing sold as label stock is over an A4 page.
const MIN_MM = 25;
const MAX_MM = 305;

function clampMm(v: number): number {
  return Math.min(MAX_MM, Math.max(MIN_MM, v));
}

// Most thermal label printers are 203dpi (8 dots/mm). A QR needs roughly 3 dots
// per module to print cleanly; below ~2 the modules blur together and scanners
// give up. Since the symbol grows with the payload, a long facility name on
// small stock is what actually breaks it — so this is checked against the real
// encoded size rather than a fixed size table.
const DPI = 203;
const DOTS_MIN = 2;
const DOTS_GOOD = 3;

function moduleDots(modules: number, qrMm: number): number {
  const quiet = 8; // 4-module quiet zone on each side
  return (qrMm / (modules + quiet) / 25.4) * DPI;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-08-25" -> "25 AUG 2026". Unambiguous on a sticker read anywhere. */
function formatPackDate(iso: string): string {
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return `${p[2]} ${MONTHS[Number(p[1]) - 1] ?? p[1]} ${p[0]}`;
}

/** Plain-text payload — deliberately not JSON, so any scanner shows it readably. */
function qrPayload(
  facility: string,
  product: string,
  lot: string,
  packDate: string,
  weightKg?: string,
  heads?: string,
): string {
  const lines = [
    `Facility: ${facility}`,
    `Product: ${product}`,
    `Lot: ${lot}`,
    `Pack Date: ${formatPackDate(packDate)}`,
  ];
  // Only emit what was actually entered — an empty "Net Weight:" line wastes
  // QR capacity and reads as missing data rather than not-applicable.
  if (weightKg) lines.push(`Net Weight: ${weightKg} kg`);
  if (heads) lines.push(`Heads: ${heads}`);
  return lines.join('\n');
}

function Label({
  facility,
  product,
  lot,
  packDate,
  weightKg,
  heads,
  widthMm,
  heightMm,
}: {
  facility: string;
  product: string;
  lot: string;
  packDate: string;
  weightKg: string;
  heads: string;
  widthMm: number;
  heightMm: number;
}) {
  // Brand rule, product, QR, then the same facts as human-readable text.
  //
  // Type and QR scale off the label width so one layout serves 40mm and 100mm
  // stock: on a fixed pt scale a 40mm label would clip its product name, and a
  // 100mm one would waste most of its area. Ratios were picked so the QR still
  // clears ~20mm (readable by a phone camera) on the smallest supported stock.
  const svg = useMemo(
    () => qrSvg(qrPayload(facility, product, lot, packDate, weightKg, heads), 300),
    [facility, product, lot, packDate, weightKg, heads],
  );

  // Type scales off the short edge, so a wide-but-short label doesn't get giant
  // text. The QR is deliberately NOT given a computed height: predicting how
  // many lines a facility name or product wraps to is what overflows labels.
  // Instead it is a flex item that may shrink (min-height:0) and never grow
  // past its width — CSS resolves the leftover space exactly, at any stock.
  const pad = Math.min(widthMm, heightMm) * 0.05;
  const short = Math.min(widthMm, heightMm);
  const brandPt = short * 0.17;
  const productPt = short * 0.2;
  const metaPt = short * 0.135;
  const qrMaxMm = widthMm - pad * 2;

  return (
    <div
      className="dp-label flex flex-col overflow-hidden bg-white text-black"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, padding: `${pad}mm` }}
    >
      <div
        className="shrink-0 border-b-2 border-black text-center font-extrabold uppercase leading-tight [overflow-wrap:anywhere]"
        style={{ fontSize: `${brandPt}pt`, paddingBottom: `${pad * 0.3}mm` }}
      >
        {facility || '—'}
      </div>
      <div
        className="shrink-0 text-center font-extrabold leading-tight [overflow-wrap:anywhere]"
        style={{ fontSize: `${productPt}pt`, marginTop: `${pad * 0.4}mm` }}
      >
        {product}
      </div>
      {/* aspect-square + min-h-0 keeps the code square while letting flex take
          back space when the text above wraps further than expected. */}
      <div
        className="mx-auto aspect-square min-h-0 w-full flex-1 [&>svg]:h-full [&>svg]:w-full"
        style={{ maxWidth: `${qrMaxMm}mm`, marginTop: `${pad * 0.4}mm` }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {/* Net weight and head count are what a receiver checks against the
          delivery, so they print larger than the rest of the small print. */}
      {(weightKg || heads) && (
        <div
          className="shrink-0 border-t-2 border-black text-center font-extrabold leading-tight"
          style={{ fontSize: `${productPt * 0.95}pt`, marginTop: `${pad * 0.4}mm`, paddingTop: `${pad * 0.3}mm` }}
        >
          {weightKg && <span className="tabular-nums">{weightKg} kg</span>}
          {weightKg && heads && <span> · </span>}
          {heads && <span className="tabular-nums">{heads} head</span>}
        </div>
      )}
      <div className="mt-auto shrink-0 leading-snug" style={{ fontSize: `${metaPt}pt` }}>
        {[
          ['PRODUCT', product],
          ['LOT', lot || '—'],
          ['PACKED', formatPackDate(packDate)],
        ].map(([k, v], i) => (
          <div
            key={k}
            className={`flex gap-1 ${i === 0 ? 'border-t border-black' : 'border-t border-slate-400'}`}
            style={{ paddingTop: `${pad * 0.15}mm`, paddingBottom: `${pad * 0.15}mm` }}
          >
            <span className="shrink-0 font-bold tracking-wide">{k}</span>
            <span className="ml-auto text-right tabular-nums [overflow-wrap:anywhere]">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DressingPlantLabelsPage() {
  const [sizes, setSizes] = useState<SizeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sizeId, setSizeId] = useState('');
  const [lot, setLot] = useState('');
  const [packDate, setPackDate] = useState(todayIso());
  const [weightKg, setWeightKg] = useState('');
  const [heads, setHeads] = useState('');
  const [copies, setCopies] = useState('1');
  const [formError, setFormError] = useState<string | null>(null);

  const [issuing, setIssuing] = useState(false);
  const [issuedLots, setIssuedLots] = useState<LotRow[]>([]);
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [facilityId, setFacilityId] = useState('');

  const [stockId, setStockId] = useState(DEFAULT_STOCK.id);
  const [customW, setCustomW] = useState(String(DEFAULT_STOCK.widthMm));
  const [customH, setCustomH] = useState(String(DEFAULT_STOCK.heightMm));

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  useEffect(() => {
    // Restore the stock this station prints on — an operator sets it once.
    try {
      const raw = localStorage.getItem(LS_SIZE);
      if (raw) {
        const s = JSON.parse(raw);
        if (s?.id === CUSTOM) {
          setStockId(CUSTOM);
          setCustomW(String(s.widthMm));
          setCustomH(String(s.heightMm));
        } else if (STOCKS.some((k) => k.id === s?.id)) {
          setStockId(s.id);
        }
      }
    } catch {
      /* unreadable or private mode — fall back to the default stock */
    }
  }, []);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    api
      .get<{ data: SizeRow[] }>(`/dressing-plant/sizes?company_id=${companyId}`)
      .then((r) => {
        setSizes(r.data);
        // Prefer a real classification over any legacy plain size row.
        const first = r.data.find((s) => s.class_group) ?? r.data[0];
        if (first) setSizeId(first.id);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [companyId]);

  // Facilities are managed reference data (Administration -> Master Data), so
  // one plant cannot reach the shelf under three spellings.
  useEffect(() => {
    if (!companyId) return;
    api
      .get<{ data: FacilityRow[] }>(`/dressing-plant/facilities?company_id=${companyId}`)
      .then((r) => {
        setFacilities(r.data);
        // Prefer the company default, then whatever this station used last.
        const remembered = localStorage.getItem(LS_FACILITY);
        const pick =
          r.data.find((f) => f.is_default) ??
          r.data.find((f) => f.id === remembered) ??
          r.data[0];
        if (pick) setFacilityId(pick.id);
      })
      .catch(() => setFacilities([]));
  }, [companyId]);

  // Show what has already been issued for this pack date, and drop any lot held
  // from a different date — a lot belongs to the date it was drawn against.
  useEffect(() => {
    if (!companyId || !packDate) return;
    setLot('');
    api
      .get<{ data: LotRow[] }>(
        `/dressing-plant/label-lots?company_id=${companyId}&pack_date=${packDate}`,
      )
      .then((r) => setIssuedLots(r.data))
      .catch(() => setIssuedLots([]));
  }, [companyId, packDate]);

  // Group for the dropdown, preserving the sort_order the API returned.
  const grouped = useMemo(() => {
    const out: { group: string; rows: SizeRow[] }[] = [];
    for (const s of sizes) {
      const g = s.class_group || 'Sizes';
      const bucket = out.find((o) => o.group === g);
      if (bucket) bucket.rows.push(s);
      else out.push({ group: g, rows: [s] });
    }
    return out;
  }, [sizes]);

  const selected = useMemo(() => sizes.find((s) => s.id === sizeId), [sizes, sizeId]);
  const product = selected?.label_name ?? '';

  // The printed name always comes from the managed list — never free text.
  const facility = useMemo(
    () => facilities.find((f) => f.id === facilityId)?.name ?? '',
    [facilities, facilityId],
  );

  const onFacility = (id: string) => {
    setFacilityId(id);
    try {
      localStorage.setItem(LS_FACILITY, id);
    } catch {
      /* private mode — the choice still applies for this session */
    }
  };

  // Active label geometry. Custom entries are clamped so a typo (or an empty
  // field mid-edit) can never emit a zero-sized @page, which some drivers
  // answer by silently falling back to A4.
  const isCustom = stockId === CUSTOM;
  const { widthMm, heightMm } = useMemo(() => {
    if (isCustom) {
      return {
        widthMm: clampMm(Number(customW) || DEFAULT_STOCK.widthMm),
        heightMm: clampMm(Number(customH) || DEFAULT_STOCK.heightMm),
      };
    }
    const s = STOCKS.find((k) => k.id === stockId) ?? DEFAULT_STOCK;
    return { widthMm: s.widthMm, heightMm: s.heightMm };
  }, [isCustom, stockId, customW, customH]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_SIZE,
        JSON.stringify(isCustom ? { id: CUSTOM, widthMm, heightMm } : { id: stockId }),
      );
    } catch {
      /* the choice still applies for this session */
    }
  }, [isCustom, stockId, widthMm, heightMm]);

  const count = Number(copies);
  const countValid = Number.isInteger(count) && count >= 1 && count <= 200;

  // Normalised once, so the label, the QR and the stored row cannot disagree.
  // Weight prints to 3 dp because that is how plant scales report.
  const weightTrim = weightKg.trim();
  const headsTrim = heads.trim();
  const weightNum = weightTrim ? Number(weightTrim) : null;
  const headsNum = headsTrim ? Number(headsTrim) : null;
  const weightValid = weightNum === null || (Number.isFinite(weightNum) && weightNum > 0);
  const headsValid = headsNum === null || (Number.isInteger(headsNum) && headsNum > 0);
  const weightText = weightNum !== null && weightValid ? weightNum.toFixed(3) : '';
  const headsText = headsNum !== null && headsValid ? String(headsNum) : '';

  // Will this actually print scannably on the chosen stock? The QR ends up
  // roughly square at the label's inner width, minus what the text rows take.
  const density = useMemo(() => {
    if (!product) return null;
    const pad = Math.min(widthMm, heightMm) * 0.05;
    // Conservative: the code never gets more than the label's inner width, and
    // on short stock the height is the real limit.
    const qrMm = Math.min(widthMm - pad * 2, heightMm * 0.45);
    try {
      const modules = encodeQr(
        qrPayload(facility || '—', product, lot || '—', packDate, weightText, headsText),
      ).length;
      return { dots: moduleDots(modules, qrMm), modules, qrMm };
    } catch {
      return null;
    }
  }, [facility, product, lot, packDate, widthMm, heightMm, weightText, headsText]);

  // Safari on iOS ignores `@page { size }` — it lays every page out at the
  // sheet size chosen in the OS dialog (A4 by default), so the label lands
  // small in a corner, and it stamps its own URL/date footer that no CSS can
  // remove. A PDF sized to the stock has neither problem, so on iOS (and
  // whenever the operator asks for it) we hand over a PDF instead of calling
  // window.print().
  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      // iPadOS 13+ reports itself as a Mac; the touch points give it away.
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const openPdf = useCallback(
    async (lotNo: string) => {
      const bytes = await buildLabelPdf(
        {
          facility,
          product,
          lot: lotNo,
          packedText: formatPackDate(packDate),
          weightKg: weightText,
          heads: headsText,
          qrText: qrPayload(facility, product, lotNo, packDate, weightText, headsText),
        },
        widthMm,
        heightMm,
        count,
      );
      // Copy into a fresh ArrayBuffer: the Blob constructor rejects the
      // SharedArrayBuffer-backed view some bundlers hand back.
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) {
        // Popup blocked — fall back to a direct navigation so the operator
        // still gets the file rather than silently nothing.
        window.location.href = url;
      }
      // Give the viewer time to read the blob before revoking it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    [facility, product, packDate, weightText, headsText, widthMm, heightMm, count],
  );

  // Issue a lot and print it. The number comes from the server so it cannot
  // collide with another station's; it is allocated here — at the moment the
  // operator commits — rather than on page load, so browsing does not consume
  // lot numbers. A failure must not print: an unnumbered or guessed label is
  // exactly the traceability hole this replaces.
  const issueAndPrint = useCallback(async () => {
    if (!companyId) {
      setFormError('No company selected — sign in again.');
      return;
    }
    if (!facility) {
      setFormError('Pick a facility. Add one in Administration → Master Data → Facilities.');
      return;
    }
    if (!product) {
      setFormError('Pick a product classification.');
      return;
    }
    if (!countValid) {
      setFormError('Copies must be a whole number from 1 to 200.');
      return;
    }
    if (!weightValid) {
      setFormError('Net weight must be a positive number, or blank.');
      return;
    }
    if (!headsValid) {
      setFormError('Head count must be a positive whole number, or blank.');
      return;
    }
    setFormError(null);
    setIssuing(true);
    try {
      const row = await api.post<{ lot_no: string; seq: number }>('/dressing-plant/label-lots', {
        company_id: companyId,
        pack_date: packDate,
        size_id: sizeId,
        facility_id: facilityId,
        facility,
        copies: count,
        net_weight_kg: weightText || null,
        head_count: headsNum,
      });
      setLot(row.lot_no);
      setIssuedLots((prev) => [
        { id: row.lot_no, lot_no: row.lot_no, seq: row.seq, product, facility, copies: count, created_at: new Date().toISOString() },
        ...prev,
      ]);
      if (isIOS) {
        await openPdf(row.lot_no);
      } else {
        // Let React paint the new lot into the print sheet before the dialog
        // snapshots the page, or the labels carry the previous number.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        window.print();
      }
    } catch (e) {
      setFormError(`Could not issue a lot number: ${(e as Error).message}. Nothing was printed.`);
    } finally {
      setIssuing(false);
    }
  }, [
    companyId, product, countValid, count, packDate, sizeId, facility, facilityId,
    weightValid, headsValid, weightText, headsNum, headsText, isIOS, openPdf,
  ]);

  // Reprinting an already-issued lot must not draw a new number — the sticker
  // and the record have to stay the same batch.
  const reprint = useCallback(async () => {
    if (!lot) return;
    setFormError(null);
    if (isIOS) {
      await openPdf(lot);
      return;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.print();
  }, [lot, isIOS, openPdf]);

  const sheet = countValid && lot ? Array.from({ length: count }, (_, i) => i) : [];

  return (
    <div>
      {/* Print rules: hide the app chrome and the form, then emit one 2x3in page
          per copy. Mirrors the approach in WMS -> QR Labels. */}
      <style>{`
        @media print {
          html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body, main { background: #fff !important; height: auto !important; overflow: visible !important; }
          .h-screen { height: auto !important; }
          .overflow-hidden, .overflow-y-auto, .overflow-x-auto { overflow: visible !important; }
          /* Nothing but the labels reaches the paper: app chrome, and anything
             else the dashboard shell renders around <main>. */
          aside, header, footer, nav { display: none !important; }
          main { padding: 0 !important; }
          .dp-screen-only { display: none !important; }
          #dp-label-sheet { display: block !important; }
          /* Belt and braces: hide any body-level sibling that does not contain
             the sheet, so a portal or toast root cannot add a blank page.
             Wrapped in @supports because older engines treat an unsupported
             :has() as invalid and would drop the rule anyway — being explicit
             keeps the intent obvious. */
          @supports selector(:has(*)) {
            body > *:not(:has(#dp-label-sheet)) { display: none !important; }
          }
          #dp-label-sheet .dp-label {
            border: none !important;
            box-shadow: none !important;
            break-after: page;
            page-break-after: always;
          }
          #dp-label-sheet .dp-label:last-child { break-after: auto; page-break-after: auto; }
          /* @page cannot read a CSS variable, so the chosen stock is
             interpolated in. margin:0 matters as much as the size — a default
             margin shrinks the printable area, the driver scales the label down
             to fit, and the reclaimed strip is where browsers draw their
             URL/date/page headers. Zero margin suppresses those on engines that
             honour @page (Chrome, Edge, Firefox); Safari on iOS honours neither
             and needs the PDF path instead. */
          @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
          /* The sheet must not exceed one page box, or a second blank page
             appears carrying nothing but the browser's own header. */
          html, body { width: ${widthMm}mm !important; }
        }
      `}</style>

      <div className="dp-screen-only">
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Product Labels</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Print QR traceability stickers for dressed output on 2&times;3&Prime; thermal stock. The code
            carries the facility, classification, lot and pack date as plain text.
          </p>
        </div>

        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {!companyId && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No company selected — sign in again to load classifications.
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading classifications…</p>
        ) : !sizes.length ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No product classifications found. Run migration{' '}
            <span className="font-mono text-xs">025_dp_label_classes.sql</span> to seed them.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            {/* ---- Form ---- */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="facility" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Facility / brand name
                  </label>
                  <select
                    id="facility"
                    value={facilityId}
                    onChange={(e) => onFacility(e.target.value)}
                    disabled={!facilities.length}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {!facilities.length && <option value="">No facilities set up</option>}
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                        {f.is_default ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {facilities.length ? (
                      <>
                        Managed in{' '}
                        <Link
                          href="/dashboard/admin/master-data/facilities"
                          className="text-brand-700 hover:underline dark:text-brand-400"
                        >
                          Administration → Master Data → Facilities
                        </Link>
                        .
                      </>
                    ) : (
                      <>
                        Add one in{' '}
                        <Link
                          href="/dashboard/admin/master-data/facilities"
                          className="text-brand-700 hover:underline dark:text-brand-400"
                        >
                          Administration → Master Data → Facilities
                        </Link>{' '}
                        before printing.
                      </>
                    )}
                  </p>
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="classification" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Product classification
                  </label>
                  <select
                    id="classification"
                    value={sizeId}
                    onChange={(e) => setSizeId(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {grouped.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.rows.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {product && (
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Prints as <span className="font-medium text-slate-700 dark:text-slate-300">{product}</span>
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="lot" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Batch / lot number
                  </label>
                  <input
                    id="lot"
                    value={lot}
                    readOnly
                    placeholder="Issued when you print"
                    aria-describedby="lot-help"
                    className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100"
                  />
                  <p id="lot-help" className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Assigned by the server as <span className="font-mono">YYYYMMDD-NN</span> when you
                    print, so no two stations can issue the same number.
                    {issuedLots.length > 0 && (
                      <>
                        {' '}
                        <span className="font-medium text-slate-600 dark:text-slate-300">
                          {issuedLots.length} already issued for this date
                        </span>{' '}
                        (latest {issuedLots[0].lot_no}).
                      </>
                    )}
                  </p>
                </div>

                <div>
                  <label htmlFor="packdate" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Pack date
                  </label>
                  <input
                    id="packdate"
                    type="date"
                    value={packDate}
                    onChange={(e) => setPackDate(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label htmlFor="weight" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Net weight (kg)
                  </label>
                  <input
                    id="weight"
                    type="number"
                    min={0}
                    step="0.001"
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    placeholder="e.g. 12.500"
                    className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label htmlFor="heads" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Head count
                  </label>
                  <input
                    id="heads"
                    type="number"
                    min={0}
                    step={1}
                    value={heads}
                    onChange={(e) => setHeads(e.target.value)}
                    placeholder="e.g. 10"
                    className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Both optional — leave blank for weight-only lines such as offal.
                  </p>
                </div>

                <div>
                  <label htmlFor="copies" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Copies to print
                  </label>
                  <input
                    id="copies"
                    type="number"
                    min={1}
                    max={200}
                    step={1}
                    value={copies}
                    onChange={(e) => setCopies(e.target.value)}
                    className="w-32 rounded border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="stock" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Label stock
                  </label>
                  <select
                    id="stock"
                    value={stockId}
                    onChange={(e) => {
                      const next = e.target.value;
                      // Seed the custom boxes from whatever was showing, so
                      // switching to Custom is an edit rather than a reset.
                      if (next === CUSTOM) {
                        setCustomW(String(widthMm));
                        setCustomH(String(heightMm));
                      }
                      setStockId(next);
                    }}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {STOCKS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                    <option value={CUSTOM}>Custom…</option>
                  </select>

                  {isCustom && (
                    <div className="mt-2 flex items-end gap-2">
                      <div>
                        <label htmlFor="customW" className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                          Width (mm)
                        </label>
                        <input
                          id="customW"
                          type="number"
                          min={MIN_MM}
                          max={MAX_MM}
                          value={customW}
                          onChange={(e) => setCustomW(e.target.value)}
                          className="w-24 rounded border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <span className="pb-2.5 text-slate-400">×</span>
                      <div>
                        <label htmlFor="customH" className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                          Height (mm)
                        </label>
                        <input
                          id="customH"
                          type="number"
                          min={MIN_MM}
                          max={MAX_MM}
                          value={customH}
                          onChange={(e) => setCustomH(e.target.value)}
                          className="w-24 rounded border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </div>
                    </div>
                  )}

                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Remembered on this device. In the print dialog set the same paper size,
                    margins <span className="font-medium">None</span>, and scale{' '}
                    <span className="font-medium">100%</span> — not &ldquo;Fit to page&rdquo;.
                  </p>

                  {density && density.dots < DOTS_GOOD && (
                    <div
                      className={`mt-2 rounded border px-3 py-2 text-[11px] ${
                        density.dots < DOTS_MIN
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}
                    >
                      {density.dots < DOTS_MIN ? (
                        <>
                          <span className="font-semibold">This QR will not scan reliably.</span> At{' '}
                          {Math.round(widthMm)}×{Math.round(heightMm)} mm the {density.modules}-module
                          code prints at {density.dots.toFixed(1)} dots per module on a 203&nbsp;dpi
                          printer — under the ~2 needed.
                        </>
                      ) : (
                        <>
                          <span className="font-semibold">Tight fit.</span> {density.dots.toFixed(1)} dots
                          per module on a 203&nbsp;dpi printer. It should scan, but test one before a
                          long run.
                        </>
                      )}{' '}
                      Use larger stock, or shorten the facility name to reduce the code&rsquo;s size.
                    </div>
                  )}
                </div>
              </div>

              {formError && (
                <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {formError}
                </div>
              )}
            </div>

            {/* ---- Preview ---- */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Preview — actual size · {Math.round(widthMm)} × {Math.round(heightMm)} mm
              </p>
              <div className="flex justify-center">
                <div className="border border-slate-300 shadow-sm dark:border-slate-600">
                  <Label
                    facility={facility}
                    product={product}
                    lot={lot}
                    packDate={packDate}
                    weightKg={weightText}
                    heads={headsText}
                    widthMm={widthMm}
                    heightMm={heightMm}
                  />
                </div>
              </div>
              <button
                onClick={issueAndPrint}
                disabled={!product || issuing}
                className="mt-4 w-full rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
              >
                {issuing
                  ? 'Issuing lot…'
                  : `Issue lot & print ${countValid && count > 1 ? `${count} labels` : 'label'}`}
              </button>

              {lot && (
                <button
                  onClick={reprint}
                  disabled={issuing}
                  className="mt-2 w-full rounded border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Reprint <span className="font-mono">{lot}</span> (no new number)
                </button>
              )}

              {lot && (
                <button
                  onClick={() => openPdf(lot)}
                  disabled={issuing}
                  className="mt-2 w-full rounded border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Open as PDF ({Math.round(widthMm)}×{Math.round(heightMm)} mm)
                </button>
              )}

              <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {isIOS ? (
                  <>
                    On iPhone and iPad the label opens as a PDF already sized to the stock — Safari
                    cannot print an exact paper size on its own, and adds its own footer. Share →
                    Print, and set <span className="font-medium">Scale 100%</span>.
                  </>
                ) : (
                  <>
                    Printing directly uses the size above. If your driver adds a header, footer, or
                    margin, use <span className="font-medium">Open as PDF</span> instead — the page
                    box is exactly the label.
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Print-only sheet: one page per copy. */}
      <div id="dp-label-sheet" className="hidden">
        {product &&
          sheet.map((i) => (
            <Label
              key={i}
              facility={facility}
              product={product}
              lot={lot}
              packDate={packDate}
              weightKg={weightText}
              heads={headsText}
              widthMm={widthMm}
              heightMm={heightMm}
            />
          ))}
      </div>
    </div>
  );
}
