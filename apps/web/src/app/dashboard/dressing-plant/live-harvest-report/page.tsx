'use client';

import { useBatchReport, ReportToolbar, PRINT_CSS, minutesBetween, hhmmOf, fmt, int, ampm, type ReportTruck } from '@/components/DpReportShell';

// Live Harvest Report — one column per truck (arrival sequence) plus a total.

type Row = { label: string; cell: (t: ReportTruck) => React.ReactNode; total?: React.ReactNode; hl?: boolean; gapBefore?: boolean };

const neg = (n: number) => (n < 0 ? <span className="text-red-600">({int(-n)})</span> : int(n));

export default function LiveHarvestReportPage() {
  const { batches, batchId, setBatchId, report, error } = useBatchReport();
  const trucks = report?.trucks ?? [];
  const sum = (f: (t: ReportTruck) => number) => trucks.reduce((a, t) => a + f(t), 0);

  const farmCount = sum((t) => Number(t.farm_count || 0));
  const plantCount = sum((t) => Number(t.head_count || 0));
  const doa = sum((t) => Number(t.doa_count || 0));
  const doaKg = sum((t) => Number(t.doa_weight_kg || 0));
  const farmKg = sum((t) => Number(t.farm_weight_kg || 0));
  const plantKg = sum((t) => Number(t.net_live_weight_kg || 0));
  const coops = sum((t) => Number(t.coop_count || 0));
  const lossKg = farmKg ? farmKg - plantKg : 0;

  const rows: Row[] = [
    { label: 'Arrival sequence', cell: (t) => t.seq, total: 'TOTAL' },
    { label: 'Plate no.', cell: (t) => t.plate_no },
    { label: 'Seal number', cell: (t) => t.seal_no },
    { label: 'Farm name', cell: (t) => t.farm_name },
    { label: 'Farm address', cell: (t) => t.farm_address },
    { label: 'Building / house no.', cell: (t) => t.house_no },
    { label: 'Farm count', cell: (t) => int(t.farm_count), total: int(farmCount) },
    { label: 'Plant count', cell: (t) => int(t.head_count), total: int(plantCount) },
    { label: 'Over / short count', hl: true, cell: (t) => (t.farm_count == null ? '' : neg(Number(t.farm_count) - Number(t.head_count))), total: neg(farmCount - plantCount) },
    { label: 'Farm departure', gapBefore: true, cell: (t) => ampm(t.farm_departure) },
    { label: 'Plant arrival', cell: (t) => ampm(t.plant_arrival) },
    { label: 'Travel time', hl: true, cell: (t) => hhmmOf(minutesBetween(t.farm_departure, t.plant_arrival)) },
    { label: 'Start hang', cell: (t) => ampm(t.start_hang) },
    { label: 'End hang', cell: (t) => ampm(t.end_hang) },
    { label: 'Holding time', hl: true, cell: (t) => hhmmOf(minutesBetween(t.plant_arrival, t.start_hang)) },
    { label: 'Cooping density', gapBefore: true, cell: (t) => (t.coop_count ? fmt(Number(t.head_count) / Number(t.coop_count), 1) : ''), total: coops ? fmt(plantCount / coops, 1) : '' },
    { label: 'ALW', hl: true, cell: (t) => (t.head_count ? fmt(Number(t.net_live_weight_kg) / Number(t.head_count)) : ''), total: plantCount ? fmt(plantKg / plantCount) : '' },
    { label: 'DOA', gapBefore: true, cell: (t) => int(Number(t.doa_count || 0)), total: int(doa) },
    { label: 'DOA weight', hl: true, cell: (t) => fmt(Number(t.doa_weight_kg || 0)), total: fmt(doaKg) },
    { label: 'Total birds processed', hl: true, cell: (t) => int(Number(t.head_count) - Number(t.doa_count || 0)), total: int(plantCount - doa) },
    { label: 'Total weight processed', hl: true, cell: (t) => fmt(Number(t.net_live_weight_kg) - Number(t.doa_weight_kg || 0)), total: fmt(plantKg - doaKg) },
    { label: 'Farm weight', gapBefore: true, cell: (t) => fmt(t.farm_weight_kg == null ? null : Number(t.farm_weight_kg)), total: fmt(farmKg) },
    { label: 'Plant weight', cell: (t) => fmt(Number(t.net_live_weight_kg)), total: fmt(plantKg) },
    { label: 'Weight loss', hl: true, cell: (t) => (t.farm_weight_kg == null ? '' : fmt(Number(t.farm_weight_kg) - Number(t.net_live_weight_kg))), total: farmKg ? fmt(lossKg) : '' },
    { label: 'Weight loss %', hl: true, cell: (t) => (Number(t.farm_weight_kg) ? `${fmt(((Number(t.farm_weight_kg) - Number(t.net_live_weight_kg)) / Number(t.farm_weight_kg)) * 100)}%` : ''), total: farmKg ? `${fmt((lossKg / farmKg) * 100)}%` : '' },
    { label: 'Mortality %', hl: true, cell: (t) => (t.head_count ? `${fmt((Number(t.doa_count || 0) / Number(t.head_count)) * 100)}%` : ''), total: plantCount ? `${fmt((doa / plantCount) * 100)}%` : '' },
  ];

  const j = report?.job;
  const cellCls = 'border border-slate-300 px-2 py-0.5 text-center text-[11px] dark:border-slate-600';

  return (
    <div className="mx-auto max-w-[1400px]">
      <style>{PRINT_CSS}</style>
      <ReportToolbar title="Live Harvest Report" batches={batches} batchId={batchId} setBatchId={setBatchId} />
      {error && <div className="no-print mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {j && (
        <div className="overflow-x-auto bg-white p-2 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
          <div className="mb-2 flex items-end justify-between">
            <div className="text-[11px]">Batch <b>{j.batch_no}</b> · {j.client_name}</div>
            <h2 className="font-serif text-xl font-bold tracking-wide">LIVE HARVEST REPORT</h2>
            <table className="text-[11px]">
              <tbody>
                <tr><td className="pr-3 font-semibold">Harvest Date:</td><td>{j.harvest_date ?? '—'}</td></tr>
                <tr><td className="pr-3 font-semibold">Production Date:</td><td>{j.production_date ?? String(j.received_at ?? '').slice(0, 10)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="mb-2 border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-600"><b>PLANT CHECKER:</b> {j.plant_checker ?? ''}</div>

          {trucks.length === 0 ? <p className="text-xs text-slate-500">No trucks recorded for this batch.</p> : (
            <table className="w-full border-collapse">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className={r.gapBefore ? 'border-t-[6px] border-slate-800 dark:border-slate-400' : ''}>
                    <th className="border border-slate-300 px-2 py-0.5 text-right text-[11px] font-semibold uppercase dark:border-slate-600">{r.label}:</th>
                    {trucks.map((t) => (
                      <td key={t.seq} className={`${cellCls} ${r.hl ? 'bg-yellow-200 dark:bg-yellow-900/40' : ''}`}>{r.cell(t)}</td>
                    ))}
                    <td className={`${cellCls} font-semibold ${r.hl ? 'bg-yellow-200 dark:bg-yellow-900/40' : ''}`}>{r.total ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="no-print mt-2 text-[11px] text-slate-500">Over/short = farm − plant count (in brackets when the plant counted more). Holding time = plant arrival → start hang. Mortality % = DOA ÷ plant count.</p>
        </div>
      )}
    </div>
  );
}
