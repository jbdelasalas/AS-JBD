'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { qrSvg } from '@/lib/qr';

// Traceability stickers for dressed-chicken output. The QR carries the facility,
// classification, lot and pack date as plain readable text, so a generic phone
// camera resolves it with no app — and the same four facts print beside the code
// in case the sticker is scuffed or the scanner fails.
//
// Classifications come from dp_sizes (see migration 025), the module's managed
// size list, so Production Detail and the label printer share one vocabulary.
//
// Nothing here is persisted: the lot counter lives in localStorage so a station
// keeps printing through a network drop. That makes the counter per-device — if
// two stations label the same day, give them distinct prefixes or allocate lots
// upstream in the job order.

interface SizeRow {
  id: string;
  code: string;
  name: string;
  class_group: string | null;
  label_name: string;
}

const LS_FACILITY = 'dp.label.facility';
const LS_COUNTER = 'dp.label.counters';

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

function readCounters(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LS_COUNTER) || '{}') || {};
  } catch {
    return {};
  }
}

/** Plain-text payload — deliberately not JSON, so any scanner shows it readably. */
function qrPayload(facility: string, product: string, lot: string, packDate: string): string {
  return [
    `Facility: ${facility}`,
    `Product: ${product}`,
    `Lot: ${lot}`,
    `Pack Date: ${formatPackDate(packDate)}`,
  ].join('\n');
}

function Label({
  facility,
  product,
  lot,
  packDate,
}: {
  facility: string;
  product: string;
  lot: string;
  packDate: string;
}) {
  // 2in x 3in thermal stock: brand rule, product, QR, then the same facts as
  // human-readable text. Sized in inches so it maps 1:1 to the label roll.
  const svg = useMemo(
    () => qrSvg(qrPayload(facility, product, lot, packDate), 125),
    [facility, product, lot, packDate],
  );

  return (
    <div className="dp-label flex flex-col overflow-hidden bg-white text-black">
      <div className="border-b-2 border-black pb-1 text-center text-[9.5pt] font-extrabold uppercase leading-tight [overflow-wrap:anywhere]">
        {facility || '—'}
      </div>
      <div className="mt-1 text-center text-[11pt] font-extrabold leading-tight [overflow-wrap:anywhere]">
        {product}
      </div>
      <div
        className="mt-1 flex justify-center"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="mt-auto text-[7.6pt] leading-snug">
        {[
          ['PRODUCT', product],
          ['LOT', lot || '—'],
          ['PACKED', formatPackDate(packDate)],
        ].map(([k, v], i) => (
          <div
            key={k}
            className={`flex gap-1 py-[1.6px] ${i === 0 ? 'border-t border-black pt-[3px]' : 'border-t border-slate-400'}`}
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

  const [facility, setFacility] = useState('');
  const [sizeId, setSizeId] = useState('');
  const [lot, setLot] = useState('');
  const [packDate, setPackDate] = useState(todayIso());
  const [copies, setCopies] = useState('1');
  const [formError, setFormError] = useState<string | null>(null);

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  useEffect(() => {
    setFacility(localStorage.getItem(LS_FACILITY) || '');
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

  const onFacility = (v: string) => {
    setFacility(v);
    try {
      localStorage.setItem(LS_FACILITY, v);
    } catch {
      /* private mode — the field still works for this session */
    }
  };

  // Per-pack-date counter, so backdating a batch continues that date's sequence
  // rather than today's.
  const suggestLot = useCallback(() => {
    const key = (packDate || todayIso()).replace(/-/g, '');
    const counters = readCounters();
    const next = (Number(counters[key]) || 0) + 1;
    counters[key] = next;
    // Keep only the 60 most recent dates so the entry never grows unbounded.
    const keys = Object.keys(counters).sort();
    while (keys.length > 60) delete counters[keys.shift()!];
    try {
      localStorage.setItem(LS_COUNTER, JSON.stringify(counters));
    } catch {
      /* not persisted, but the operator still gets a usable number */
    }
    setLot(`${key}-${String(next).padStart(2, '0')}`);
    setFormError(null);
  }, [packDate]);

  const count = Number(copies);
  const countValid = Number.isInteger(count) && count >= 1 && count <= 200;

  const print = () => {
    if (!product) {
      setFormError('Pick a product classification.');
      return;
    }
    if (!lot.trim()) {
      setFormError('Enter a batch / lot number.');
      return;
    }
    if (!countValid) {
      setFormError('Copies must be a whole number from 1 to 200.');
      return;
    }
    setFormError(null);
    window.print();
  };

  const sheet = countValid ? Array.from({ length: count }, (_, i) => i) : [];

  return (
    <div>
      {/* Print rules: hide the app chrome and the form, then emit one 2x3in page
          per copy. Mirrors the approach in WMS -> QR Labels. */}
      <style>{`
        .dp-label { width: 2in; height: 3in; padding: 0.10in; }
        @media print {
          html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body, main { background: #fff !important; height: auto !important; overflow: visible !important; }
          .h-screen { height: auto !important; }
          .overflow-hidden, .overflow-y-auto, .overflow-x-auto { overflow: visible !important; }
          aside, header { display: none !important; }
          main { padding: 0 !important; }
          .dp-screen-only { display: none !important; }
          #dp-label-sheet { display: block !important; }
          #dp-label-sheet .dp-label {
            border: none !important;
            box-shadow: none !important;
            break-after: page;
            page-break-after: always;
          }
          #dp-label-sheet .dp-label:last-child { break-after: auto; page-break-after: auto; }
          @page { size: 2in 3in; margin: 0; }
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
                  <input
                    id="facility"
                    value={facility}
                    onChange={(e) => onFacility(e.target.value)}
                    maxLength={60}
                    placeholder="e.g. AFCC Dressing Plant"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Remembered on this device.
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
                  <div className="flex gap-2">
                    <input
                      id="lot"
                      value={lot}
                      onChange={(e) => setLot(e.target.value)}
                      maxLength={32}
                      placeholder="20260825-01"
                      className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={suggestLot}
                      className="shrink-0 rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Suggest
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono">YYYYMMDD-NN</span>, counted per pack date on this device.
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
                Preview — actual size
              </p>
              <div className="flex justify-center">
                <div className="border border-slate-300 shadow-sm dark:border-slate-600">
                  <Label facility={facility} product={product} lot={lot} packDate={packDate} />
                </div>
              </div>
              <button
                onClick={print}
                disabled={!product}
                className="mt-4 w-full rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
              >
                Print {countValid && count > 1 ? `${count} labels` : 'label'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Print-only sheet: one page per copy. */}
      <div id="dp-label-sheet" className="hidden">
        {product &&
          sheet.map((i) => (
            <Label key={i} facility={facility} product={product} lot={lot} packDate={packDate} />
          ))}
      </div>
    </div>
  );
}
