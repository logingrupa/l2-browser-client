export interface NativeStorePngPixels { width: number; height: number; rgba: Uint8Array<ArrayBuffer>; }

const webGpuGuaranteedTextureDimension2D = 8192;

export async function decodeNativeStorePng(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<NativeStorePngPixels> {
  signal.throwIfAborted();
  if (bytes.length < 45 || bytes.length > 32 * 1024 * 1024 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((value, i) => bytes[i] !== value)) throw new Error("Native store texture is not a bounded PNG.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), blocks: Uint8Array<ArrayBuffer>[] = [];
  let width = 0, height = 0, channels = 0, offset = 8, ended = false, idatEnded = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (length > bytes.length - offset - 12) throw new Error("Native store PNG chunk exceeds file.");
    const begin = offset + 8, end = begin + length;
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) throw new Error("Native store PNG header order is invalid.");
      width = view.getUint32(begin); height = view.getUint32(begin + 4);
      channels = bytes[begin + 9] === 2 ? 3 : bytes[begin + 9] === 6 ? 4 : 0;
      if (!channels || width < 1 || height < 1 || width > webGpuGuaranteedTextureDimension2D || height > webGpuGuaranteedTextureDimension2D ||
        bytes[begin + 8] !== 8 || bytes[begin + 10] !== 0 || bytes[begin + 11] !== 0 || bytes[begin + 12] !== 0) {
        throw new Error(`Native PNG decoding supports only noninterlaced RGB/RGBA8 images up to ${webGpuGuaranteedTextureDimension2D} pixels per edge.`);
      }
    } else if (type === "IDAT") {
      if (!width || idatEnded) throw new Error("Native store PNG data order is invalid.");
      blocks.push(bytes.slice(begin, end));
    } else {
      if (blocks.length) idatEnded = true;
      if (type === "IEND") { if (length || end + 4 !== bytes.length) throw new Error("Native store PNG has trailing data."); ended = true; break; }
      if (type === "tRNS" || (type.charCodeAt(0) & 32) === 0) throw new Error(`Native store PNG chunk is unsupported: ${type}`);
    }
    offset = end + 4;
  }
  if (!ended || !blocks.length || !channels) throw new Error("Native store PNG is incomplete.");
  const stride = width * channels, filteredScanlineBytes = (stride + 1) * height, packed = new Uint8Array(filteredScanlineBytes);
  const reader = new Blob(blocks).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  let used = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      if (used + part.value.length > filteredScanlineBytes) throw new Error("Native store PNG decompressed size exceeds dimensions.");
      packed.set(part.value, used); used += part.value.length;
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  signal.throwIfAborted();
  if (used !== filteredScanlineBytes) throw new Error("Native store PNG decompressed size differs from dimensions.");
  const scan = new Uint8Array(stride * height), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)]!;
    if (filter > 4) throw new Error("Native store PNG filter is invalid.");
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? scan[y * stride + x - channels]! : 0;
      const above = y ? scan[(y - 1) * stride + x]! : 0;
      const upperLeft = y && x >= channels ? scan[(y - 1) * stride + x - channels]! : 0;
      const p = left + above - upperLeft, a = Math.abs(p - left), b = Math.abs(p - above), c = Math.abs(p - upperLeft);
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : a <= b && a <= c ? left : b <= c ? above : upperLeft;
      scan[y * stride + x] = packed[y * (stride + 1) + 1 + x]! + prediction;
    }
  }
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba[pixel * 4] = scan[pixel * channels]!; rgba[pixel * 4 + 1] = scan[pixel * channels + 1]!;
    rgba[pixel * 4 + 2] = scan[pixel * channels + 2]!; rgba[pixel * 4 + 3] = channels === 4 ? scan[pixel * channels + 3]! : 255;
  }
  return { width, height, rgba };
}
