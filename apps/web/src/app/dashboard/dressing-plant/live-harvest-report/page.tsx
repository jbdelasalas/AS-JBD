'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useBatchReport, PRINT_CSS, minutesBetween, hhmmOf, fmt, int, ampm, type ReportTruck } from '@/components/DpReportShell';

// Live Harvest Report — one column per truck (arrival sequence) plus a total,
// for one batch or for every batch harvested on a day.

type Truck = ReportTruck & { batch_no?: string };
type Row = { label: string; cell: (t: Truck) => React.ReactNode; total?: React.ReactNode; hl?: boolean; gapBefore?: boolean };
interface DayReport { date: string; plant_checker: string | null; production_date: string | null; batches: string[]; trucks: Truck[] }

const neg = (n: number) => (n < 0 ? <span className="text-red-600">({int(-n)})</span> : int(n));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

export default function LiveHarvestReportPage() {
  const { batches, batchId, setBatchId, report, error } = useBatchReport();
  const [mode, setMode] = useState<'batch' | 'day'>('batch');
  const [day, setDay] = useState(today());
  const [dayReport, setDayReport] = useState<DayReport | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  useEffect(() => {
    if (mode !== 'day' || !companyId || !day) return;
    setDayError(null);
    api.get<DayReport>(`/dressing-plant/harvest-day?company_id=${companyId}&date=${day}`).then(setDayReport).catch((e) => setDayError(e.message));
  }, [mode, day, companyId]);

  const j = report?.job;
  const trucks: Truck[] = (mode === 'day' ? dayReport?.trucks : report?.trucks) ?? [];
  const header = mode === 'day'
    ? { title: `${dayReport?.batches.length ?? 0} batch(es): ${dayReport?.batches.join(', ') ?? ''}`, harvest: day, production: dayReport?.production_date ?? '', checker: dayReport?.plant_checker ?? '' }
    : { title: j ? `Batch ${j.batch_no} · ${j.client_name}` : '', harvest: j?.harvest_date ?? '—', production: j?.production_date ?? String(j?.received_at ?? '').slice(0, 10), checker: j?.plant_checker ?? '' };

  const sum = (list: Truck[], f: (t: Truck) => number) => list.reduce((a, t) => a + f(t), 0);
  // Farm figures only count trucks that have them, so a missing farm count
  // doesn't show the whole plant count as "over".
  const withFarm = trucks.filter((t) => t.farm_count != null);
  const withFarmKg = trucks.filter((t) => t.farm_weight_kg != null);
  const farmCount = sum(withFarm, (t) => Number(t.farm_count));
  const overShort = sum(withFarm, (t) => Number(t.farm_count) - Number(t.head_count));
  const plantCount = sum(trucks, (t) => Number(t.head_count || 0));
  const doa = sum(trucks, (t) => Number(t.doa_count || 0));
  const doaKg = sum(trucks, (t) => Number(t.doa_weight_kg || 0));
  const farmKg = sum(withFarmKg, (t) => Number(t.farm_weight_kg));
  const lossKg = farmKg - sum(withFarmKg, (t) => Number(t.net_live_weight_kg));
  const plantKg = sum(trucks, (t) => Number(t.net_live_weight_kg || 0));
  const coops = sum(trucks, (t) => Number(t.coop_count || 0));

  const rows: Row[] = [
    { label: 'Arrival sequence', cell: (t) => t.seq, total: 'TOTAL' },
    ...(mode === 'day' ? [{ label: 'Batch', cell: (t: Truck) => t.batch_no }] : []),
    { label: 'Plate no.', cell: (t) => t.plate_no },
    { label: 'Seal number', cell: (t) => t.seal_no },
    { label: 'Farm name', cell: (t) => t.farm_name },
    { label: 'Farm address', cell: (t) => t.farm_address },
    { label: 'Building / house no.', cell: (t) => t.house_no },
    { label: 'Farm count', cell: (t) => int(t.farm_count), total: withFarm.length ? int(farmCount) : '' },
    { label: 'Plant count', cell: (t) => int(t.head_count), total: int(plantCount) },
    { label: 'Over / short count', hl: true, cell: (t) => (t.farm_count == null ? '' : neg(Number(t.farm_count) - Number(t.head_count))), total: withFarm.length ? neg(overShort) : '' },
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
    { label: 'Farm weight', gapBefore: true, cell: (t) => fmt(t.farm_weight_kg == null ? null : Number(t.farm_weight_kg)), total: withFarmKg.length ? fmt(farmKg) : '' },
    { label: 'Plant weight', cell: (t) => fmt(Number(t.net_live_weight_kg)), total: fmt(plantKg) },
    { label: 'Weight loss', hl: true, cell: (t) => (t.farm_weight_kg == null ? '' : fmt(Number(t.farm_weight_kg) - Number(t.net_live_weight_kg))), total: withFarmKg.length ? fmt(lossKg) : '' },
    { label: 'Weight loss %', hl: true, cell: (t) => (Number(t.farm_weight_kg) ? `${fmt(((Number(t.farm_weight_kg) - Number(t.net_live_weight_kg)) / Number(t.farm_weight_kg)) * 100)}%` : ''), total: farmKg ? `${fmt((lossKg / farmKg) * 100)}%` : '' },
    { label: 'Mortality %', hl: true, cell: (t) => (t.head_count ? `${fmt((Number(t.doa_count || 0) / Number(t.head_count)) * 100)}%` : ''), total: plantCount ? `${fmt((doa / plantCount) * 100)}%` : '' },
  ];

  const cellCls = 'border border-slate-300 px-2 py-0.5 text-center text-[11px] dark:border-slate-600';
  const inputCls = 'rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const shown = mode === 'day' ? !!dayReport : !!j;

  return (
    <div className="mx-auto max-w-[1400px]">
      <style>{PRINT_CSS}</style>
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Live Harvest Report</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded border border-slate-300 text-xs dark:border-slate-600">
              {(['batch', 'day'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-1.5 ${mode === m ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                  {m === 'batch' ? 'Per batch' : 'Per day'}
                </button>
              ))}
            </div>
            {mode === 'batch' ? (
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={inputCls}>
                {batches.length === 0 && <option value="">No received batches</option>}
                {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_no} — {b.client_name}</option>)}
              </select>
            ) : (
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputCls} />
            )}
          </div>
        </div>
        <button onClick={() => window.print()} disabled={!trucks.length}
          className="rounded bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Print</button>
      </div>
      {(error || dayError) && <div className="no-print mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error || dayError}</div>}

      {shown && (
        <div className="overflow-x-auto bg-white p-2 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div className="max-w-xs text-[11px]">{header.title}</div>
            <h2 className="font-serif text-xl font-bold tracking-wide">LIVE HARVEST REPORT</h2>
            <table className="text-[11px]">
              <tbody>
                <tr><td className="pr-3 font-semibold">Harvest Date:</td><td>{header.harvest}</td></tr>
                <tr><td className="pr-3 font-semibold">Production Date:</td><td>{header.production}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="mb-2 border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-600"><b>PLANT CHECKER:</b> {header.checker}</div>

          {trucks.length === 0 ? <p className="text-xs text-slate-500">{mode === 'day' ? 'No trucks harvested on this day.' : 'No trucks recorded for this batch.'}</p> : (
            <table className="w-full border-collapse">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className={r.gapBefore ? 'border-t-[6px] border-slate-800 dark:border-slate-400' : ''}>
                    <th className="border border-slate-300 px-2 py-0.5 text-right text-[11px] font-semibold uppercase dark:border-slate-600">{r.label}:</th>
                    {trucks.map((t, i) => (
                      <td key={i} className={`${cellCls} ${r.hl ? 'bg-yellow-200 dark:bg-yellow-900/40' : ''}`}>{r.cell(t)}</td>
                    ))}
                    <td className={`${cellCls} font-semibold ${r.hl ? 'bg-yellow-200 dark:bg-yellow-900/40' : ''}`}>{r.total ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="no-print mt-2 text-[11px] text-slate-500">
            Over/short = farm − plant count (in brackets when the plant counted more); trucks without a farm count are left out of the total.
            Holding time = plant arrival → start hang. Mortality % = DOA ÷ plant count.
            {mode === 'day' && ' Per day = batches whose harvest date is this day (or trucks received this day when no harvest date is set).'}
          </p>
        </div>
      )}
    </div>
  );
}
