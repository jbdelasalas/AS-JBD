'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { qrSvg } from '@/lib/qr';

// Label registry + print sheet. Labels render as inline SVG generated in the
// browser, so printing works with no network round-trip and no image assets.

type Entity = 'bin' | 'box' | 'pallet';

interface LabelRow {
  code: string; entity_type: Entity; entity_id: string;
  title: string; subtitle: string | null; detail: string | null;
  printed_at: string | null;
}

const TABS: { key: Entity | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'bin', label: 'Bins' },
  { key: 'pallet', label: 'Pallets' },
  { key: 'box', label: 'Boxes' },
];

const KIND_LABEL: Record<Entity, string> = { bin: 'BIN', box: 'BOX', pallet: 'PALLET' };

function Label({ row }: { row: LabelRow }) {
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

export default function LabelsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [rows, setRows] = useState<LabelRow[]>([]);
  const [tab, setTab] = useState<Entity | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { setCompanyId(localStorage.getItem('company_id')); }, []);

  const load = useCallback((cid: string) => {
    setLoading(true);
    api.get<{ data: LabelRow[] }>(`/wms/scan/labels?company_id=${cid}`)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (companyId) load(companyId); }, [companyId, load]);

  const visible = useMemo(
    () => (tab === 'all' ? rows : rows.filter((r) => r.entity_type === tab)),
    [rows, tab],
  );

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const issueMissing = async (entity: Entity) => {
    if (!companyId) return;
    setNotice(null);
    try {
      const res = await api.post<{ issued: number }>('/wms/scan/labels', {
        company_id: companyId, entity_type: entity, all: true,
      });
      setNotice(res.issued ? `Issued ${res.issued} new ${entity} label(s).` : `Every ${entity} already has a label.`);
      load(companyId);
    } catch (e) { setError((e as Error).message); }
  };

  const printSelected = async () => {
    const codes = selected.size ? [...selected] : visible.map((r) => r.code);
    if (!codes.length) return;
    window.print();
    if (companyId) {
      api.patch('/wms/scan/labels', { company_id: companyId, codes }).catch(() => {});
    }
  };

  // Only the chosen labels should reach the printer.
  const toPrint = selected.size ? visible.filter((r) => selected.has(r.code)) : visible;

  return (
    <div>
      {/* Print styles — hide the app chrome and the on-screen picker, then lay
          the chosen labels out as a two-up sticker sheet. */}
      <style>{`
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
      `}</style>

      <div className="qr-screen-only">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">QR Labels</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Print stickers for bins, pallets and boxes, then move stock with{' '}
              <Link href="/dashboard/wms/scan" className="text-brand-700 hover:underline dark:text-brand-400">Scan &amp; Move</Link>.
            </p>
          </div>
          <button
            onClick={printSelected}
            disabled={!visible.length}
            className="shrink-0 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            Print {selected.size ? `${selected.size} selected` : 'all shown'}
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSelected(new Set()); }}
              className={`rounded px-3 py-1 text-xs font-medium ${
                tab === t.key ? 'bg-brand-600 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
          <span className="mx-1 text-slate-300 dark:text-slate-600">|</span>
          {(['bin', 'pallet', 'box'] as Entity[]).map((e) => (
            <button
              key={e}
              onClick={() => issueMissing(e)}
              className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              + Label new {e}s
            </button>
          ))}
        </div>

        {notice && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}
        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : !visible.length ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No labels yet — use “+ Label new …” above to issue them.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              {selected.size ? `${selected.size} selected · ` : ''}Click a label to select it for printing.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((r) => (
                <button
                  key={r.code}
                  onClick={() => toggle(r.code)}
                  className={`rounded-lg text-left transition ${
                    selected.has(r.code) ? 'ring-2 ring-brand-500' : 'ring-1 ring-transparent hover:ring-slate-300'
                  }`}
                >
                  <Label row={r} />
                  {r.printed_at && (
                    <p className="px-2 pb-1 text-[10px] text-slate-400">
                      printed {new Date(r.printed_at).toLocaleDateString()}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Print-only sheet: `hidden` keeps it off screen, and the print rules
          above flip it back to a grid on paper. */}
      <div id="print-sheet" className="hidden">
        {toPrint.map((r) => <Label key={r.code} row={r} />)}
      </div>
    </div>
  );
}
