// 生成 32x32 应用图标（resources/icon.png）：暖橙圆角方块 + 白色对勾
// 零依赖，直接用 Node 内置 zlib 手写 PNG 编码
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 512;
const RADIUS = 128;
const ORANGE = [217, 72, 15, 255];
const WHITE = [255, 255, 255, 255];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/** 计算 PNG 数据块需要的 CRC32 校验值。 */
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 将数据和校验值封装成 PNG 数据块。 */
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 计算像素点到线段的最短距离，用于绘制图标笔画。 */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** 判断像素是否位于图标的圆角矩形区域内。 */
function insideRoundedRect(x, y) {
  const half = SIZE / 2 - 1;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const dx = Math.max(Math.abs(x - cx) - (half - RADIUS), 0);
  const dy = Math.max(Math.abs(y - cy) - (half - RADIUS), 0);
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

/** 判断像素是否属于图标中的勾选笔画。 */
function isCheckStroke(x, y) {
  return (
    distToSegment(x, y, 144, 272, 224, 352) <= 32 || distToSegment(x, y, 224, 352, 360, 184) <= 32
  );
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    let color = [0, 0, 0, 0];
    if (insideRoundedRect(x, y)) {
      color = isCheckStroke(x, y) ? WHITE : ORANGE;
    }
    const offset = rowStart + 1 + x * 4;
    raw[offset] = color[0];
    raw[offset + 1] = color[1];
    raw[offset + 2] = color[2];
    raw[offset + 3] = color[3];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "resources");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "icon.png");
fs.writeFileSync(outFile, png);
console.log(`icon written: ${outFile} (${png.length} bytes)`);
