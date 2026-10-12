// Reads an order list pasted from Excel (tab-separated) or a CSV file into
// planner stops. One row per product line; rows sharing an SO number become one
// stop carrying several items, so the sheet can be the usual "SO / customer /
// address / product / qty" layout without pre-grouping.
//
// Columns are matched by header name, in any order. Only SO, customer and
// address are required; weight falls back to qty when the unit is kg.

import type { PlanStop, PlanItem } from './types';

const ALIASES: Record<string, string[]> = {
  so:       ['so', 'so no', 'so #', 'so#', 'so no#', 'so number', 'sales order', 'order', 'order no', 'order #', 'ref', 'reference'],
  customer: ['customer', 'customer name', 'client', 'name', 'store', 'outlet', 'account'],
  address:  ['address', 'delivery address', 'location', 'ship to', 'shipping address'],
  product:  ['product', 'item', 'item name', 'description', 'sku'],
  qty:      ['qty', 'quantity', 'pcs', 'heads', 'units'],
  uom:      ['uom', 'unit', 'units of measure'],
  kg:       ['kg', 'kgs', 'kilos', 'weight', 'weight kg', 'weight (kg)', 'total kg', 'net kg'],
  from:     ['from', 'window from', 'receive from', 'time from', 'earliest'],
  to:       ['to', 'window to', 'receive until', 'time to', 'latest', 'deadline'],
  remarks:  ['remarks', 'notes', 'note', 'instructions', 'comment', 'comments'],
};

function splitRow(line: string, sep: string): string[] {
  // Excel wraps a cell in quotes when it holds quotes or line breaks.
  if (sep === '\t') return line.split('\t').map((c) => c.trim().replace(/^"(.*)"$/s, '$1').replace(/""/g, '"'));
  // CSV with quoted fields ("Lipa City, Batangas").
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** "7", "7am", "7:30 AM", "13:00" → "HH:MM"; anything else → null. */
export function normalizeTime(v: string | undefined): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export interface ImportResult { stops: PlanStop[]; warnings: string[] }

export function parseOrderSheet(text: string): ImportResult {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return { stops: [], warnings: ['Paste a header row plus at least one order row.'] };

  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const header = splitRow(lines[0], sep).map((h) => h.toLowerCase().replace(/[^a-z0-9#() ]/g, ' ').replace(/\s+/g, ' ').trim());
  const col: Record<string, number> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[field] = i;
  }
  const missing = ['so', 'customer', 'address'].filter((f) => col[f] == null);
  if (missing.length) {
    return { stops: [], warnings: [`Could not find column(s): ${missing.join(', ')}. Header row seen: ${header.join(' | ')}`] };
  }

  const warnings: string[] = [];
  const bySo = new Map<string, PlanStop>();
  lines.slice(1).forEach((line, n) => {
    const c = splitRow(line, sep);
    const get = (f: string) => (col[f] != null ? c[col[f]] ?? '' : '');
    const so = get('so').trim();
    if (!so) { warnings.push(`Row ${n + 2}: no SO number — skipped.`); return; }

    const uom = get('uom') || (col.kg != null ? '' : 'kg');
    const qty = num(get('qty'));
    const kgCell = col.kg != null ? num(get('kg')) : 0;
    const kg = kgCell > 0 ? kgCell : /^(kg|kgs|kilo|kilos)$/i.test(uom) ? qty : 0;
    const item: PlanItem | null = get('product') || qty
      ? { product: get('product') || '(item)', qty, uom: uom || 'pc', kg: kg || null }
      : null;

    let s = bySo.get(so);
    if (!s) {
      s = {
        id: so, so_ref: so, sales_order_id: null, customer_id: null,
        customer: get('customer'), address: get('address'),
        lat: null, lng: null, pin: 'missing', kg: 0, items: [],
        window_from: normalizeTime(get('from')), window_to: normalizeTime(get('to')),
        remarks: get('remarks'), needs_reefer: true, small_truck_only: false, vehicle_id: null,
      };
      bySo.set(so, s);
    } else {
      const r = get('remarks');
      if (r && !s.remarks.includes(r)) s.remarks = s.remarks ? `${s.remarks} · ${r}` : r;
      if (get('address') && get('address') !== s.address) warnings.push(`${so}: rows have different addresses — kept the first.`);
    }
    if (item) s.items.push(item);
    s.kg += kg;
  });

  const stops = [...bySo.values()];
  const noKg = stops.filter((s) => s.kg <= 0).map((s) => s.id);
  if (noKg.length) warnings.push(`No weight for ${noKg.length} order(s) (${noKg.slice(0, 5).join(', ')}${noKg.length > 5 ? '…' : ''}) — enter kg before optimizing.`);
  return { stops, warnings };
}
