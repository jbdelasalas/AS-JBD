'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { QrLabel as Label, LABEL_PRINT_CSS, type LabelRow, type LabelEntity } from '@/components/QrLabel';

// Label registry + print sheet.

type Entity = LabelEntity;

const TABS: { key: Entity | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'bin', label: 'Bins' },
  { key: 'pallet', label: 'Pallets' },
  { key: 'box', label: 'Boxes' },
];

export default function LabelsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [rows, setRows] = useState<LabelRow[]>([]);
  const [logo, setLogo] = useState<string | null>(null);
  const [tab, setTab] = useState<Entity | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { setCompanyId(localStorage.getItem('company_id')); }, []);

  const load = useCallback((cid: string) => {
    setLoading(true);
    api.get<{ data: LabelRow[]; logo: string | null }>(`/wms/scan/labels?company_id=${cid}`)
      .then((r) => { setRows(r.data); setLogo(r.logo ?? null); })
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
      <style>{LABEL_PRINT_CSS}</style>

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
            <div className="flex flex-wrap gap-3">
              {visible.map((r) => (
                <button
                  key={r.code}
                  onClick={() => toggle(r.code)}
                  className={`rounded-lg text-left transition ${
                    selected.has(r.code) ? 'ring-2 ring-brand-500' : 'ring-1 ring-transparent hover:ring-slate-300'
                  }`}
                >
                  <Label row={r} logo={logo} />
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
        {toPrint.map((r) => <Label key={r.code} row={r} logo={logo} />)}
      </div>
    </div>
  );
}
