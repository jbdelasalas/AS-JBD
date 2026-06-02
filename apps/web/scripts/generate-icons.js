/**
 * Generates placeholder PWA icons as solid-color PNGs.
 * Run: node apps/web/scripts/generate-icons.js
 * Replace generated files with real logo once available.
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../public/icons');

// AFCC brand colors: deep teal background, white foreground
const BG = { r: 0x0f, g: 0x4c, b: 0x75 }; // #0f4c75 - deep navy blue

function uint32BE(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n, 0);
  return buf;
}

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  return Buffer.concat([uint32BE(data.length), typeBuffer, data, uint32BE(crc32(crcInput))]);
}

function createPlaceholderPNG(size, bg) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.concat([
    uint32BE(size), uint32BE(size),
    Buffer.from([8, 2, 0, 0, 0]) // 8-bit, RGB, no interlace
  ]);
  const ihdr = createChunk('IHDR', ihdrData);

  // Build scanlines: 1 filter byte + size*3 RGB bytes per row
  const row = Buffer.alloc(1 + size * 3, 0);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = bg.r;
    row[2 + x * 3] = bg.g;
    row[3 + x * 3] = bg.b;
  }
  const rows = [];
  for (let y = 0; y < size; y++) rows.push(row);
  const compressed = zlib.deflateSync(Buffer.concat(rows));
  const idat = createChunk('IDAT', compressed);

  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

for (const size of sizes) {
  const png = createPlaceholderPNG(size, BG);
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}x${size}.png`;
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`Created ${name} (${png.length} bytes)`);
}

// Also write a minimal 16x16 favicon.ico (just a PNG renamed — most modern browsers accept this)
const favicon = createPlaceholderPNG(32, BG);
fs.writeFileSync(path.join(OUT_DIR, 'favicon.ico'), favicon);
console.log('Created favicon.ico');

console.log('\nDone! Replace these placeholder icons with the real AFCC logo.');
