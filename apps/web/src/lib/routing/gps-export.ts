// Writes a confirmed plan's trips in the layout of the GPS tracker's
// "Trip Summary Report" (trip_summary_report_<Company>_<date>.xlsx), so the
// planned side — trip, truck, driver, depot, each SO's drop and its planned
// arrival — lines up column-for-column with what the tracker reports back.
// The "actual" columns (arrival, departure, dwell, HIT/MISS, on-time %) are
// left blank: those are the tracker's to fill.
//
// Two sheets, as in the tracker's export:
//   Trip Summary         — one row per drop
//   Trip Summary Per SO  — one row per drop, with the SO number
// Trip-level cells repeat on every row so the sheet filters and pivots cleanly.

import ExcelJS from 'exceljs';

export interface ExportStop {
  seq: number;
  so_ref: string | null;
  customer_name: string;
  customer_code: string | null;   // used as the drop-off geofence code
  eta: string | null;             // "HH:MM"
  leg_km: number | null;          // from the previous stop (or the depot)
  leg_min: number | null;
}

export interface ExportTrip {
  trip_no: string;
  plate_no: string;
  vehicle_type: string | null;
  status: string;
  driver_name: string | null;
  depart_time: string | null;     // "HH:MM"
  planned_km: number | null;
  planned_minutes: number | null;
  stops: ExportStop[];
}

export interface ExportInput {
  company: string;
  date: string;                   // YYYY-MM-DD
  depot: { code: string | null; name: string };
  trips: ExportTrip[];
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3C78D8' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, size: 10, bold: true };
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' },
};

const hmm = (min: number | null) => {
  if (min == null || !Number.isFinite(min)) return '';
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
const at = (date: string, hhmm: string | null) => (hhmm ? `${date} ${hhmm}` : '');
const km = (v: number | null) => (v == null ? '' : Math.round(v * 10) / 10);

/**
 * Columns from B onward, as [group header | null, sub header]. A group header
 * spans its consecutive sub-columns (row 5 merged across, row 6 per column);
 * a column with no group is merged down rows 5–6.
 */
function columns(perSo: boolean): [string | null, string][] {
  const trip: [string | null, string][] = [
    [null, 'Trip number'], [null, 'Plate number'], [null, 'Hauler'], [null, 'Subgroup'],
    [null, 'Vehicle type'], [null, 'Trip Status'],
    [null, perSo ? 'GPS Status ( as of report generation)' : 'GPS Status'], [null, 'Driver Name'],
  ];
  const pu: [string | null, string][] = ['Pickups', 'Geofence Code (PU)', 'Planned Arrival Time', 'Actual Arrival Time',
    'HIT/MISS', 'Actual Departure Time', 'Dwell Time (h:mm)'].map((h) => ['Pickups', h]);
  const doCols = ['Destinations', 'Geofence Code (DO)', ...(perSo ? ['SO Number'] : []), 'Planned Arrival Time',
    'Actual Arrival Time', 'HIT/MISS', 'Actual Departure Time', 'Dwell Time (h:mm)'].map((h) => ['Destinations', h] as [string, string]);
  const perf: [string | null, string][] = [
    [null, 'On-time performance DROPOFF and PICKUP (%) '], [null, 'On-time performance DROPOFF ONLY (%)'],
    [null, 'Distance Travelled (Per DO) (km)'], [null, 'Travel Duration (Per DO) (h:mm)'],
    ...(perSo ? [] : [[null, 'Total Distance Travelled (km)'], [null, 'Total Travel Duration (h:mm)']] as [null, string][]),
  ];
  return [...trip, ...pu, ...doCols, ...perf];
}

function addSheet(wb: ExcelJS.Workbook, input: ExportInput, perSo: boolean) {
  const ws = wb.addWorksheet(perSo ? 'Trip Summary Per SO' : 'Trip Summary');
  const cols = columns(perSo);
  const first = 2; // column B

  ws.getCell(2, first).value = perSo ? 'TRIP SUMMARY REPORT PER SO' : 'TRIP SUMMARY REPORT';
  ws.getCell(2, first).font = { bold: true, size: 12 };
  ws.getCell(3, first).value = `PLANNED — From ${input.date} 00:00:00 to ${input.date} 23:59:00 , exported from ERP Trip Planning`;
  ws.getCell(3, first).font = { size: 10 };

  // Header rows 5–6.
  let c = 0;
  while (c < cols.length) {
    const [group, sub] = cols[c];
    const col = first + c;
    if (!group) {
      ws.mergeCells(5, col, 6, col);
      ws.getCell(5, col).value = sub;
      c++;
      continue;
    }
    let end = c;
    while (end + 1 < cols.length && cols[end + 1][0] === group) end++;
    ws.mergeCells(5, col, 5, first + end);
    ws.getCell(5, col).value = group;
    for (let k = c; k <= end; k++) ws.getCell(6, first + k).value = cols[k][1];
    c = end + 1;
  }
  for (let r = 5; r <= 6; r++) {
    for (let k = 0; k < cols.length; k++) {
      const cell = ws.getCell(r, first + k);
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = THIN;
    }
  }
  ws.getRow(6).height = 30;

  // One row per drop.
  let r = 7;
  for (const t of input.trips) {
    for (const s of t.stops) {
      const values: (string | number)[] = [
        t.trip_no, t.plate_no, input.company, '', t.vehicle_type ?? '', t.status, '', t.driver_name ?? '',
        // Pickup: the depot, planned at departure.
        input.depot.name, input.depot.code ?? '', at(input.date, t.depart_time), '', '', '', '',
        // Drop-off.
        s.customer_name, s.customer_code ?? '', ...(perSo ? [s.so_ref ?? ''] : []), at(input.date, s.eta), '', '', '', '',
        // Performance: on-time % is the tracker's; planned distance/time per drop are ours.
        '', '', km(s.leg_km), hmm(s.leg_min),
        ...(perSo ? [] : [km(t.planned_km), hmm(t.planned_minutes)]),
      ];
      values.forEach((v, k) => {
        const cell = ws.getCell(r, first + k);
        cell.value = v;
        cell.border = THIN;
        cell.font = { size: 10 };
      });
      r++;
    }
  }

  ws.getColumn(1).width = 4;
  cols.forEach(([, sub], k) => { ws.getColumn(first + k).width = Math.min(30, Math.max(14, sub.length * 0.9)); });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 6 }];
}

export async function buildTripSummaryXlsx(input: ExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP Trip Planning';
  addSheet(wb, input, false);
  addSheet(wb, input, true);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
