// Parse the dressing-plant weighing machine's export (one row per weighing:
// Date, Time, Batch Number, Product Code, Number of Heads, Weight) from .xlsx
// or .csv, and total it per product for the Production Detail grid.

export interface Weighing { machineBatch: string; productCode: string; heads: number; weight: number; }
export interface ProductTotal { productCode: string; packs: number; heads: number; weight: number; }

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.result !== undefined) return cellText(o.result);
    if (o.text !== undefined) return cellText(o.text);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

const toNum = (s: string) => Number(s.replace(/,/g, ''));

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

async function readGrid(file: File): Promise<string[][]> {
  if (/\.(csv|txt)$/i.test(file.name)) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const sep = ['\t', ';', ','].find((s) => lines[0]?.includes(s)) ?? ',';
    return lines.map((l) => splitCsvLine(l, sep));
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  const grid: string[][] = [];
  ws?.eachRow((row) => {
    const vals = row.values as unknown[]; // 1-based
    grid.push(vals.slice(1).map(cellText));
  });
  return grid;
}

/** Read every weighing row. Throws with a readable message when the layout is not recognised. */
export async function parseWeighingFile(file: File): Promise<Weighing[]> {
  const grid = await readGrid(file);
  const headerAt = grid.findIndex((r) => r.some((c) => /product\s*code/i.test(c)) && r.some((c) => /weight/i.test(c)));
  if (headerAt < 0) throw new Error('Could not find the "Product Code" and "Weight" columns in this file');
  const head = grid[headerAt];
  const col = (re: RegExp) => head.findIndex((c) => re.test(c));
  const cProduct = col(/product\s*code/i), cWeight = col(/weight/i), cHeads = col(/head/i), cBatch = col(/batch/i);

  const out: Weighing[] = [];
  for (const r of grid.slice(headerAt + 1)) {
    const productCode = norm(r[cProduct] ?? '');
    const weight = toNum(r[cWeight] ?? '');
    if (!productCode || !(weight > 0)) continue; // blank / total rows
    out.push({
      productCode,
      weight,
      heads: cHeads >= 0 ? toNum(r[cHeads] ?? '') || 0 : 0,
      machineBatch: cBatch >= 0 ? (r[cBatch] ?? '').trim() : '',
    });
  }
  if (!out.length) throw new Error('No weighing rows found under the header');
  return out;
}

/** Packs = number of weighings, heads and weight summed, per product (L/U bands folded together). */
export function totalByProduct(rows: Weighing[]): ProductTotal[] {
  const by = new Map<string, ProductTotal>();
  for (const r of rows) {
    const code = itemNameFor(r.productCode);
    const t = by.get(code) ?? { productCode: code, packs: 0, heads: 0, weight: 0 };
    t.packs += 1; t.heads += r.heads; t.weight += r.weight;
    by.set(code, t);
  }
  return [...by.values()].map((t) => ({ ...t, weight: +t.weight.toFixed(3) }));
}

/**
 * The item name a machine code stands for. The machine splits some sizes into
 * lower/upper weight bands (FCA 0.9L / FCA 0.9U) and writes no-label as
 * "NL 0.9L"; items only go down to the size, so both fold into FCA 0.9 / FCA 0.9 NL.
 */
export function itemNameFor(code: string): string {
  if (norm(code) === 'FCC') return 'FCC ASSORTED';
  const m = norm(code).match(/^(FCA|NL)\s*(\d+(?:\.\d+)?)\s*[LU]?$/);
  if (!m) return norm(code);
  return `FCA ${m[2]}${m[1] === 'NL' ? ' NL' : ''}`;
}

/** Match a machine product code to an item by name or SKU, ignoring case and spacing. */
export function matchItem<T extends { id: string; name: string; sku?: string }>(items: T[], code: string): T | undefined {
  const c = norm(code);
  const mapped = itemNameFor(code);
  return items.find((i) => norm(i.name) === c)
    ?? items.find((i) => norm(i.name) === mapped)
    ?? items.find((i) => i.sku && norm(i.sku) === c);
}

const DAYS: Record<string, string> = { A: 'Mon', B: 'Tue', C: 'Wed', D: 'Thu', E: 'Fri', F: 'Sat', G: 'Sun' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "A107DP" / "A17DP" → "Mon, week 1, Jul" (day letter, week of month, month, DP). '' when not in that form. */
export function describeMachineBatch(code: string): string {
  const m = code.trim().toUpperCase().match(/^([A-G])([1-5])(0?[1-9]|1[0-2])DP$/);
  return m ? `${DAYS[m[1]]}, week ${m[2]}, ${MONTHS[Number(m[3]) - 1]}` : '';
}
