// Minimal QR Code encoder (byte mode, ECC level M) with no runtime dependency.
//
// Label printing has to work offline on the floor, and the payloads we encode
// are short fixed-format codes (e.g. "BIN-a1b2…", ~36 chars), so a full QR
// library would be dead weight. This covers versions 1–10, which spans well
// past what our codes need; encode() throws if a payload doesn't fit.
//
// Implements ISO/IEC 18004: byte-mode bitstream, Reed–Solomon ECC, block
// interleaving, all 8 data masks with the standard penalty scoring, and the
// BCH-coded format bits.

const EC_LEVEL_M = 0;

// Per version (index 1–10): [total codewords, ec codewords per block, group-1
// block count, group-2 block count] for ECC level M.
const VERSION_SPEC: Record<number, { total: number; ecPerBlock: number; g1: number; g2: number }> = {
  1:  { total: 26,   ecPerBlock: 10, g1: 1, g2: 0 },
  2:  { total: 44,   ecPerBlock: 16, g1: 1, g2: 0 },
  3:  { total: 70,   ecPerBlock: 26, g1: 1, g2: 0 },
  4:  { total: 100,  ecPerBlock: 18, g1: 2, g2: 0 },
  5:  { total: 134,  ecPerBlock: 24, g1: 2, g2: 0 },
  6:  { total: 172,  ecPerBlock: 16, g1: 4, g2: 0 },
  7:  { total: 196,  ecPerBlock: 18, g1: 4, g2: 0 },
  8:  { total: 242,  ecPerBlock: 22, g1: 2, g2: 2 },
  9:  { total: 292,  ecPerBlock: 22, g1: 3, g2: 2 },
  10: { total: 346,  ecPerBlock: 26, g1: 4, g2: 1 },
};

const ALIGNMENT_CENTERS: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// --- GF(256) arithmetic, primitive polynomial 0x11D ---------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial for `degree` EC codewords. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let d = 0; d < degree; d++) {
    const next = new Uint8Array(poly.length + 1);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];
      next[i + 1] ^= gfMul(poly[i], EXP[d]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

// --- Bitstream ----------------------------------------------------------------
class BitBuffer {
  bits: number[] = [];
  put(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

function chooseVersion(byteLen: number): number {
  for (let v = 1; v <= 10; v++) {
    const spec = VERSION_SPEC[v];
    const blocks = spec.g1 + spec.g2;
    const dataCodewords = spec.total - spec.ecPerBlock * blocks;
    // 4 mode bits + count field (8 bits for v1–9, 16 for v10+) + payload.
    const countBits = v < 10 ? 8 : 16;
    if (dataCodewords * 8 >= 4 + countBits + byteLen * 8) return v;
  }
  throw new Error(`QR payload too long (${byteLen} bytes); max supported is version 10`);
}

function buildDataCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const spec = VERSION_SPEC[version];
  const blocks = spec.g1 + spec.g2;
  const dataCodewords = spec.total - spec.ecPerBlock * blocks;

  const bb = new BitBuffer();
  bb.put(0b0100, 4);                                  // byte mode
  bb.put(bytes.length, version < 10 ? 8 : 16);        // character count
  for (const b of bytes) bb.put(b, 8);

  const capacity = dataCodewords * 8;
  bb.put(0, Math.min(4, capacity - bb.bits.length));   // terminator
  while (bb.bits.length % 8 !== 0) bb.bits.push(0);    // pad to byte boundary

  const out = new Uint8Array(dataCodewords);
  for (let i = 0; i < bb.bits.length / 8; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i * 8 + j];
    out[i] = byte;
  }
  // Alternating pad bytes fill the remainder.
  const PADS = [0xec, 0x11];
  for (let i = bb.bits.length / 8, p = 0; i < dataCodewords; i++, p++) out[i] = PADS[p % 2];
  return out;
}

/** Split into blocks, RS-encode each, then interleave data and EC codewords. */
function interleave(data: Uint8Array, version: number): Uint8Array {
  const spec = VERSION_SPEC[version];
  const blocks = spec.g1 + spec.g2;
  const totalData = data.length;
  const g1Len = Math.floor(totalData / blocks);
  const g2Len = g1Len + 1;

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < blocks; b++) {
    const len = b < spec.g1 ? g1Len : g2Len;
    const block = data.subarray(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, spec.ecPerBlock));
  }

  const out: number[] = [];
  for (let i = 0; i < g2Len; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return new Uint8Array(out);
}

// --- Matrix -------------------------------------------------------------------
type Matrix = { size: number; modules: Int8Array }; // -1 = free, 0/1 = set

function idx(m: Matrix, r: number, c: number) { return r * m.size + c; }

function placeFinder(m: Matrix, row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                     (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m.modules[idx(m, rr, cc)] = inRing || inCore ? 1 : 0;
    }
  }
}

function buildMatrix(version: number, codewords: Uint8Array, mask: number): Matrix {
  const size = version * 4 + 17;
  const m: Matrix = { size, modules: new Int8Array(size * size).fill(-1) };

  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    if (m.modules[idx(m, 6, i)] === -1) m.modules[idx(m, 6, i)] = v;
    if (m.modules[idx(m, i, 6)] === -1) m.modules[idx(m, i, 6)] = v;
  }

  // Alignment patterns (skip where they'd collide with a finder).
  const centers = ALIGNMENT_CENTERS[version];
  for (const r of centers) {
    for (const c of centers) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          m.modules[idx(m, r + dr, c + dc)] = ring === 1 ? 0 : 1;
        }
      }
    }
  }

  m.modules[idx(m, size - 8, 8)] = 1; // dark module

  // Reserve format areas so data placement skips them.
  const reserved: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (m.modules[idx(m, 8, i)] === -1) { m.modules[idx(m, 8, i)] = 0; reserved.push(idx(m, 8, i)); }
    if (m.modules[idx(m, i, 8)] === -1) { m.modules[idx(m, i, 8)] = 0; reserved.push(idx(m, i, 8)); }
  }
  for (let i = 0; i < 8; i++) {
    if (m.modules[idx(m, 8, size - 1 - i)] === -1) { m.modules[idx(m, 8, size - 1 - i)] = 0; reserved.push(idx(m, 8, size - 1 - i)); }
    if (m.modules[idx(m, size - 1 - i, 8)] === -1) { m.modules[idx(m, size - 1 - i, 8)] = 0; reserved.push(idx(m, size - 1 - i, 8)); }
  }
  // Versions 7+ carry two 6x3 version-information blocks (next to the top-right
  // and bottom-left finders). Reserve them here; writeVersionBits fills them in
  // after masking, since they are never masked.
  if (version >= 7) {
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 3; b++) {
        const tr = idx(m, a, size - 11 + b);
        const bl = idx(m, size - 11 + b, a);
        m.modules[tr] = 0; reserved.push(tr);
        m.modules[bl] = 0; reserved.push(bl);
      }
    }
  }

  const reservedSet = new Set(reserved);

  // Zig-zag data placement, right to left, skipping the vertical timing column.
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let cOff = 0; cOff < 2; cOff++) {
        const col = right - cOff;
        const cell = idx(m, row, col);
        if (m.modules[cell] !== -1 && !reservedSet.has(cell)) continue;
        if (reservedSet.has(cell)) continue;
        const byte = codewords[bitIndex >>> 3];
        const bit = byte === undefined ? 0 : (byte >>> (7 - (bitIndex & 7))) & 1;
        bitIndex++;
        m.modules[cell] = bit ^ (maskBit(mask, row, col) ? 1 : 0);
      }
    }
    upward = !upward;
  }

  writeFormatBits(m, mask);
  writeVersionBits(m, version);
  return m;
}

/**
 * Version-information blocks, required from version 7 up: the 6-bit version
 * with an 18-bit BCH(18,6) code, mirrored beside the top-right and bottom-left
 * finders. Omitting them makes a v7+ symbol unreadable to conforming scanners.
 */
function writeVersionBits(m: Matrix, version: number) {
  if (version < 7) return;
  const size = m.size;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = ((rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25)) & 0xfff;
  const bits = (version << 12) | rem;

  for (let i = 0; i < 18; i++) {
    const bit = (bits >>> i) & 1;
    const a = Math.floor(i / 3);
    const b = i % 3;
    m.modules[idx(m, a, size - 11 + b)] = bit;   // top-right block
    m.modules[idx(m, size - 11 + b, a)] = bit;   // bottom-left block
  }
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function writeFormatBits(m: Matrix, mask: number) {
  const size = m.size;
  const data = (EC_LEVEL_M << 3) | mask;   // ECC-M is 0b00 encoded as 0 here
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i < 15; i++) {
    const bit = (bits >>> i) & 1;
    // Copy 1 around the top-left finder: bits 0-5 run down column 8, then the
    // strip turns the corner at the timing row and bits 9-14 run left along
    // row 8. (idx() takes (row, col) — the two must not be swapped, or the
    // whole strip transposes and no scanner can read the symbol.)
    if (i < 6)        m.modules[idx(m, i, 8)] = bit;
    else if (i === 6) m.modules[idx(m, 7, 8)] = bit;
    else if (i === 7) m.modules[idx(m, 8, 8)] = bit;
    else if (i === 8) m.modules[idx(m, 8, 7)] = bit;
    else              m.modules[idx(m, 8, 14 - i)] = bit;

    // Copy 2: bits 0-7 along row 8 from the right edge, bits 8-14 up column 8
    // from the bottom edge.
    if (i < 8) m.modules[idx(m, 8, size - 1 - i)] = bit;
    else       m.modules[idx(m, size - 15 + i, 8)] = bit;
  }
}

// --- Mask penalty scoring (ISO 18004 §8.8.2) ---------------------------------
function penalty(m: Matrix): number {
  const size = m.size;
  const get = (r: number, c: number) => m.modules[idx(m, r, c)];
  let score = 0;

  // Rule 1: runs of 5+ same-colour modules.
  for (let r = 0; r < size; r++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        const cur = horizontal ? get(r, c) : get(c, r);
        const prev = horizontal ? get(r, c - 1) : get(c - 1, r);
        if (cur === prev) { run++; } else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = get(r, c);
      if (v === get(r, c + 1) && v === get(r + 1, c) && v === get(r + 1, c + 1)) score += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with 4 light modules either side.
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (vals: number[], pat: number[]) => pat.every((p, i) => vals[i] === p);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c + 11 <= size; c++) {
      const row: number[] = [], col: number[] = [];
      for (let i = 0; i < 11; i++) { row.push(get(r, c + i)); col.push(get(c + i, r)); }
      if (matches(row, P1) || matches(row, P2)) score += 40;
      if (matches(col, P1) || matches(col, P2)) score += 40;
    }
  }

  // Rule 4: deviation of dark-module ratio from 50%.
  let dark = 0;
  for (let i = 0; i < m.modules.length; i++) if (m.modules[i] === 1) dark++;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/** Encode `text` and return the module matrix as rows of booleans (true = dark). */
export function encodeQr(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const codewords = interleave(buildDataCodewords(bytes, version), version);

  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = buildMatrix(version, codewords, mask);
    const score = penalty(candidate);
    if (score < bestScore) { bestScore = score; best = candidate; }
  }

  const m = best!;
  const rows: boolean[][] = [];
  for (let r = 0; r < m.size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < m.size; c++) row.push(m.modules[idx(m, r, c)] === 1);
    rows.push(row);
  }
  return rows;
}

/**
 * Render `text` as a self-contained SVG string.
 * `size` is the pixel width/height; a 4-module quiet zone is always included.
 */
export function qrSvg(text: string, size = 160): string {
  const rows = encodeQr(text);
  const quiet = 4;
  const dim = rows.length + quiet * 2;

  // One path for every dark module keeps the SVG small and printer-friendly.
  let path = '';
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows.length; c++) {
      if (rows[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`;
}
