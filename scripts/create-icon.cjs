const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
const folder = path.join(__dirname, '../assets');
fs.mkdirSync(folder, { recursive: true });
function crc32(data) {
  let c = -1;
  for (const b of data) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ -1) >>> 0;
}
function chunk(name, data) {
  const tag = Buffer.from(name);
  const n = Buffer.alloc(4);
  n.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([n, tag, data, crc]);
}
function distance(x, y, ax, ay, bx, by) {
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)),
  );
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size,
        py = (y + 0.5) / size;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const round = Math.hypot(
        Math.max(Math.abs(px - 0.5) - 0.29, 0),
        Math.max(Math.abs(py - 0.5) - 0.29, 0),
      );
      if (round > 0.19) continue;
      const white =
        Math.min(
          distance(px, py, 0.27, 0.51, 0.43, 0.67),
          distance(px, py, 0.43, 0.67, 0.74, 0.34),
        ) < 0.052;
      raw[i] = white ? 255 : 24;
      raw[i + 1] = white ? 255 : 126;
      raw[i + 2] = white ? 255 : 108;
      raw[i + 3] = 255;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const sizes = [16, 32, 48, 256],
  images = sizes.map(png),
  header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const j = 6 + i * 16;
  header[j] = s === 256 ? 0 : s;
  header[j + 1] = s === 256 ? 0 : s;
  header.writeUInt16LE(1, j + 4);
  header.writeUInt16LE(32, j + 6);
  header.writeUInt32LE(images[i].length, j + 8);
  header.writeUInt32LE(offset, j + 12);
  offset += images[i].length;
});
fs.writeFileSync(path.join(folder, 'icon.ico'), Buffer.concat([header, ...images]));
fs.writeFileSync(path.join(folder, 'icon.png'), png(256));
