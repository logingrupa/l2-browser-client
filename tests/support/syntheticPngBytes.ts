import { deflateSync } from "node:zlib";

function pngChunkCrc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; }
  return (value ^ 0xffffffff) >>> 0;
}
export function syntheticPngBytes(width: number, height: number, channels: 3 | 4, pixels: Uint8Array, filters: number[] = [0]): Uint8Array<ArrayBuffer> {
  const stride = width * channels, rows = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length]!; rows[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels]! : 0, above = y ? pixels[(y - 1) * stride + x]! : 0;
      const diagonal = y && x >= channels ? pixels[(y - 1) * stride + x - channels]! : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      if (filter === 2) prediction = above;
      if (filter === 3) prediction = (left + above) >>> 1;
      if (filter === 4) {
        const guess = left + above - diagonal, distances = [Math.abs(guess - left), Math.abs(guess - above), Math.abs(guess - diagonal)];
        prediction = [left, above, diagonal][distances.indexOf(Math.min(...distances))]!;
      }
      rows[y * (stride + 1) + x + 1] = pixels[y * stride + x]! - prediction;
    }
  }
  const header = new Uint8Array(13), hv = new DataView(header.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height); header[8] = 8; header[9] = channels === 3 ? 2 : 6;
  const chunks = [["IHDR", header], ["IDAT", new Uint8Array(deflateSync(rows))], ["IEND", new Uint8Array()]] as const;
  const result = new Uint8Array(8 + chunks.reduce((sum, [, data]) => sum + data.length + 12, 0));
  result.set([137, 80, 78, 71, 13, 10, 26, 10]); const view = new DataView(result.buffer); let at = 8;
  for (const [type, data] of chunks) {
    view.setUint32(at, data.length); result.set(new TextEncoder().encode(type), at + 4); result.set(data, at + 8);
    view.setUint32(at + 8 + data.length, pngChunkCrc(result.subarray(at + 4, at + 8 + data.length))); at += 12 + data.length;
  }
  return result;
}
