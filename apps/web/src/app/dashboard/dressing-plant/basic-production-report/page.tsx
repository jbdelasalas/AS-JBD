'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useBatchReport, ReportToolbar, PRINT_CSS, fmt, int, type ReportLine } from '@/components/DpReportShell';

// Basic Production Report — per batch. Live side from the trucks, by-products and
// dressed output from the production lines; packaging, trimmings, ice, manpower,
// DAA and prepared-by are typed here and saved with the batch (report_extras).

// By-product rows in sheet order: [label, item name, standard %]. Items in the
// By-Products category that aren't listed are appended after.
const BYPRODUCTS: [string, string, number | null][] = [
  ['Good Liver', 'Good Liver', 2.5], ['Pale Liver', 'Pale Liver', null], ['Gizzard', 'Gizzard', 1.5],
  ['Condemned Liver', 'Condemned Liver', null], ['Condemned Feet', 'Condemned Feet', null],
  ['Good Feet', 'Good Feet', 3.4], ['Trimmed Feet', 'Trimmed Feet', 1.36], ['Bumble Feet', 'Bumble Feet', null],
  ['Heads', 'Heads', 2], ['Small Intestine', 'Small Intestine', null], ['Large Intestine', 'Large Intestine', null],
  ['Provent', 'Proven', 0.4], ['Crops', 'Crops', 0.4], ['Blood', 'Blood', 1.5], ['Fats', 'Fats', 0.62],
  ['Trachea', 'Trachea', 0.14], ['Cooked Small', 'Small Intestine COOKED', 1.6], ['Cooked Large', 'Large Intestine COOKED', 0.8],
];
const GIBLETS = ['Good Liver', 'Pale Liver', 'Gizzard'];
const GIBLET_STANDARD = 4;
const NECK_ITEM = 'Neck';

const EXTRA_FIELDS = {
  packaging: [['galantina', 'GALANTINA 28X28'], ['plain_poly', 'PLAIN POLY'], ['branded_poly', 'BRANDED POLY'], ['tape', 'NOPE TAPE']],
  manpower: [['docking', 'DOCKING'], ['evis', 'EVIS'], ['packing', 'PACKING']],
} as const;

const up = (s: string) => s.trim().toUpperCase();

export default function BasicProductionReportPage() {
  const { batches, batchId, setBatchId, report, error, setError, reload } = useBatchReport();
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { setExtras(report?.job.report_extras ?? {}); setSaved(false); }, [report]);

  const j = report?.job;
  const trucks = report?.trucks ?? [];
  const lines = report?.lines ?? [];
  const sum = (f: (t: (typeof trucks)[number]) => number) => trucks.reduce((a, t) => a + f(t), 0);

  const farmCount = sum((t) => Number(t.farm_count || 0)), farmKg = sum((t) => Number(t.farm_weight_kg || 0));
  const plantCount = sum((t) => Number(t.head_count || 0)), plantKg = sum((t) => Number(t.net_live_weight_kg || 0));
  const doa = sum((t) => Number(t.doa_count || 0)), doaKg = sum((t) => Number(t.doa_weight_kg || 0));
  // Per truck: plant counted fewer than the farm = short, more = over.
  const short = sum((t) => (t.farm_count != null && t.head_count < t.farm_count ? t.farm_count - t.head_count : 0));
  const over = sum((t) => (t.farm_count != null && t.head_count > t.farm_count ? t.head_count - t.farm_count : 0));
  const birdCount = plantCount - doa, birdKg = plantKg - doaKg;
  const pct = (kg: number) => (birdKg > 0 ? (kg / birdKg) * 100 : null);

  const line = (name: string) => lines.find((l) => up(l.item_name) === up(name));
  const isBy = (l: ReportLine) => /by-?product/i.test(l.category) && up(l.item_name) !== up(NECK_ITEM);
  const listed = new Set(BYPRODUCTS.map(([, item]) => up(item)));
  const byRows = [
    ...BYPRODUCTS.map(([label, item, std]) => ({ label, l: line(item), std })),
    ...lines.filter((l) => isBy(l) && !listed.has(up(l.item_name))).map((l) => ({ label: l.item_name, l, std: null as number | null })),
  ];
  const byKg = lines.filter(isBy).reduce((a, l) => a + Number(l.weight_kg), 0);
  const byBags = lines.filter(isBy).reduce((a, l) => a + Number(l.packs || 0), 0);
  const gibletKg = GIBLETS.reduce((a, n) => a + Number(line(n)?.weight_kg ?? 0), 0);
  const stdTotal = BYPRODUCTS.reduce((a, [, , s]) => a + (s ?? 0), 0);

  // Dressed output: neck-on sizes (FCA 1.0 → "10"), neckless (FCA 1.0 NL), others, then neck.
  const out = lines.filter((l) => !isBy(l) && up(l.item_name) !== up(NECK_ITEM));
  const size = (l: ReportLine) => up(l.item_name).match(/^FCA (\d+(?:\.\d+)?)( NL)?$/);
  const label = (l: ReportLine) => { const m = size(l); return m ? String(Math.round(Number(m[1]) * 10)) : up(l.item_name) === 'FCC ASSORTED' ? 'FCC' : l.item_name; };
  const bySize = (a: ReportLine, b: ReportLine) => Number(size(a)?.[1] ?? 0) - Number(size(b)?.[1] ?? 0);
  const neckOn = out.filter((l) => size(l) && !size(l)![2]).sort(bySize);
  const neckless = out.filter((l) => size(l)?.[2]).sort(bySize);
  const others = out.filter((l) => !size(l));
  const neck = line(NECK_ITEM);
  const outHeads = out.reduce((a, l) => a + Number(l.heads || 0), 0);
  const outKg = out.reduce((a, l) => a + Number(l.weight_kg), 0) + Number(neck?.weight_kg ?? 0);

  async function saveExtras() {
    if (!batchId) return;
    try { await api.put('/dressing-plant/batch-info', { job_order_id: batchId, report_extras: extras }); setSaved(true); reload(); }
    catch (e) { setError((e as Error).message); }
  }
  const ex = (k: string) => (
    <input value={extras[k] ?? ''} onChange={(e) => { setExtras((p) => ({ ...p, [k]: e.target.value })); setSaved(false); }}
      className="w-full bg-transparent text-right text-[11px] outline-none focus:bg-yellow-50 dark:focus:bg-slate-800" />
  );
  const manpowerTotal = EXTRA_FIELDS.manpower.reduce((a, [k]) => a + Number(extras[k] || 0), 0);

  const c = 'border border-slate-300 px-1.5 py-0.5 text-[11px] dark:border-slate-600';
  const r = `${c} text-right`;
  const head = `${c} bg-slate-100 font-semibold text-center dark:bg-slate-800`;
  const outRow = (l: ReportLine | undefined, lbl: string) => (
    <tr key={lbl}>
      <td className={`${c} text-center`}>{lbl}</td>
      <td className={r}>{l ? int(Number(l.packs || 0)) : ''}</td>
      <td className={r}>{l && Number(l.heads) ? int(Number(l.heads)) : ''}</td>
      <td className={r}>{l ? fmt(Number(l.weight_kg)) : ''}</td>
      <td className={r}>{l && Number(l.heads) ? fmt(Number(l.weight_kg) / Number(l.heads), 3) : ''}</td>
    </tr>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <style>{PRINT_CSS.replace('size: landscape', 'size: portrait')}</style>
      <ReportToolbar title="Basic Production Report" batches={batches} batchId={batchId} setBatchId={setBatchId} />
      {error && <div className="no-print mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {j && (
        <div className="bg-white p-3 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="text-sm font-bold">ART FRESH CHICKEN CORP.</div>
              <div className="mt-1 text-sm font-semibold underline">BASIC PRODUCTION REPORT</div>
            </div>
            <table className="text-[11px]"><tbody>
              <tr><td className="pr-2 font-semibold">DATE:</td><td>{j.production_date ?? String(j.received_at ?? '').slice(0, 10)}</td></tr>
              <tr><td className="pr-2 font-semibold">ALW:</td><td>{plantCount ? fmt(plantKg / plantCount, 4) : ''}</td></tr>
              <tr><td className="pr-2 font-semibold">FARM:</td><td>{j.farm_location ?? trucks[0]?.farm_name ?? ''}</td></tr>
              <tr><td className="pr-2 font-semibold">BATCH:</td><td>{j.batch_no}</td></tr>
            </tbody></table>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Left: live side, by-products, packaging, ice, manpower */}
            <div className="space-y-3">
              <table className="w-full border-collapse"><tbody>
                <tr><td className={c}>CUSTOMER:</td><td className={c} colSpan={2}>{j.client_name}</td></tr>
                <tr><td className={c}>NO. OF TRUCK:</td><td className={c} colSpan={2}>{trucks.length}</td></tr>
              </tbody></table>

              <table className="w-full border-collapse"><tbody>
                <tr><td className={c}>FARM COUNT</td><td className={r}>{int(farmCount)}</td><td className={r}>{fmt(farmKg)}</td></tr>
                <tr><td className={c}>PLANT COUNT</td><td className={r}>{int(plantCount)}</td><td className={r}>{fmt(plantKg)}</td></tr>
                <tr><td className={c}>DOA</td><td className={r}>{int(doa)}</td><td className={r}>{fmt(doaKg, 3)}</td></tr>
                <tr><td className={c}>DAA</td><td className={r}>{ex('daa')}</td><td className={r}>{ex('daa_kg')}</td></tr>
                <tr><td className={c}>SHORT</td><td className={r}>{int(short)}</td><td className={r} /></tr>
                <tr><td className={c}>OVER</td><td className={r}>{int(over)}</td><td className={r} /></tr>
                <tr className="bg-slate-100 font-semibold dark:bg-slate-800"><td className={c}>BIRD PROCESS</td><td className={r}>{int(birdCount)}</td><td className={r}>{fmt(birdKg)}</td></tr>
              </tbody></table>

              <table className="w-full border-collapse">
                <thead><tr>
                  <th className={head}>DESCRIPTION</th><th className={head}>BAGS</th><th className={head}>KILOS</th><th className={head}>STANDARD</th><th className={head}>PERCENTAGE</th>
                </tr></thead>
                <tbody>
                  <tr><td className={`${head}`} colSpan={5}>BY PRODUCT</td></tr>
                  {byRows.map(({ label: lb, l, std }) => (
                    <tr key={lb}>
                      <td className={c}>{lb}</td>
                      <td className={r}>{l ? int(Number(l.packs || 0)) : ''}</td>
                      <td className={r}>{l ? fmt(Number(l.weight_kg), 0) : ''}</td>
                      <td className={r}>{std ?? ''}</td>
                      <td className={r}>{l ? fmt(pct(Number(l.weight_kg))) : std != null ? '0.00' : ''}</td>
                    </tr>
                  )).flatMap((row, i) => (byRows[i].label === 'Gizzard' ? [row, (
                    <tr key="giblets" className="bg-slate-100 font-semibold dark:bg-slate-800">
                      <td className={c}>Liver + gizzard</td><td className={r} /><td className={r}>{fmt(gibletKg, 0)}</td>
                      <td className={r}>{GIBLET_STANDARD.toFixed(2)}</td><td className={r}>{fmt(pct(gibletKg))}</td>
                    </tr>
                  )] : [row]))}
                  <tr className="bg-slate-100 font-semibold dark:bg-slate-800">
                    <td className={c}>TOTAL</td><td className={r}>{int(byBags)}</td><td className={r}>{fmt(byKg, 0)}</td>
                    <td className={r}>{fmt(stdTotal)}</td><td className={r}>{fmt(pct(byKg))}</td>
                  </tr>
                </tbody>
              </table>

              <table className="w-full border-collapse"><tbody>
                <tr><td className={head} colSpan={2}>PACKAGING MATERIALS</td></tr>
                {EXTRA_FIELDS.packaging.map(([k, lb]) => <tr key={k}><td className={c}>{lb}</td><td className={r}>{ex(k)}</td></tr>)}
              </tbody></table>

              <table className="w-full border-collapse"><tbody>
                <tr><td className={c}>TRIMMINGS</td><td className={c}>KILOS</td><td className={r}>{ex('trimmings_kg')}</td></tr>
                <tr><td className={c}>ICE</td><td className={c}>CRATES</td><td className={r}>{ex('ice_crates')}</td><td className={r}>{ex('ice_crates_kg')}</td></tr>
                <tr><td className={c} /><td className={c}>SACKS</td><td className={r}>{ex('ice_sacks')}</td><td className={r}>{ex('ice_sacks_kg')}</td></tr>
              </tbody></table>

              <table className="w-full border-collapse"><tbody>
                <tr><td className={head} colSpan={2}>MANPOWER</td></tr>
                {EXTRA_FIELDS.manpower.map(([k, lb]) => <tr key={k}><td className={c}>{lb}</td><td className={r}>{ex(k)}</td></tr>)}
                <tr className="font-semibold"><td className={c}>TOTAL</td><td className={r}>{manpowerTotal || ''}</td></tr>
              </tbody></table>
            </div>

            {/* Right: production output */}
            <div>
              <table className="w-full border-collapse">
                <thead>
                  <tr><th className={head} colSpan={5}>PRODUCTION OUTPUT</th></tr>
                  <tr><th className={head}>CLASSIFICATION</th><th className={head}>BAGS</th><th className={head}>HEADS</th><th className={head}>KILOS</th><th className={head}>ADW</th></tr>
                </thead>
                <tbody>
                  <tr><td className={`${c} font-semibold`} colSpan={5}>NECK ON A/B</td></tr>
                  {neckOn.map((l) => outRow(l, label(l)))}
                  <tr><td className={`${c} font-semibold`} colSpan={5}>NECKLESS</td></tr>
                  {neckless.map((l) => outRow(l, label(l)))}
                  {others.length > 0 && <tr><td className={`${c} font-semibold`} colSpan={5}>OTHERS</td></tr>}
                  {others.map((l) => outRow(l, label(l)))}
                  {neck && outRow(neck, 'NECK')}
                  <tr className="font-semibold"><td className={c}>TOTAL:</td><td className={r} /><td className={r}>{int(outHeads)}</td><td className={r}>{fmt(outKg)}</td><td className={r} /></tr>
                  <tr className="font-semibold"><td className={c}>RECOVERY</td><td className={r} colSpan={2}>{fmt(pct(outKg))}</td><td className={r} colSpan={2} /></tr>
                  <tr className="font-semibold"><td className={c}>RECOVERY with GIBLETS</td><td className={r} colSpan={2}>{fmt(pct(outKg + gibletKg))}</td><td className={r} colSpan={2} /></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 text-[11px]">
            <span>Prepared by:</span>
            <input value={extras.prepared_by ?? ''} onChange={(e) => { setExtras((p) => ({ ...p, prepared_by: e.target.value })); setSaved(false); }}
              className="w-56 border-b border-slate-400 bg-transparent outline-none" />
          </div>

          <div className="no-print mt-3 flex items-center justify-end gap-2">
            <span className="text-[11px] text-slate-500">Recovery = output kg ÷ bird-process kg. Percentages are of bird-process kg.</span>
            <button onClick={saveExtras} className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">{saved ? 'Saved ✓' : 'Save typed entries'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
