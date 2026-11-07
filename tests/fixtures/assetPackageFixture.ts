import { crc32, sha256, type AssetPackageManifest } from "../../src/assets/package/readAssetPackage";

const encoder = new TextEncoder();
export function storedPackage(entries: readonly { name: string; bytes: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [], directory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.length + entry.bytes.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, crc, true); view.setUint32(18, entry.bytes.length, true); view.setUint32(22, entry.bytes.length, true); view.setUint16(26, name.length, true);
    local.set(name, 30); local.set(entry.bytes, 30 + name.length); locals.push(local);
    const central = new Uint8Array(46 + name.length), record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true); record.setUint16(4, 20, true); record.setUint16(6, 20, true); record.setUint16(8, 0x800, true);
    record.setUint32(16, crc, true); record.setUint32(20, entry.bytes.length, true); record.setUint32(24, entry.bytes.length, true);
    record.setUint16(28, name.length, true); record.setUint32(42, offset, true); central.set(name, 46); directory.push(central); offset += local.length;
  }
  const directoryLength = directory.reduce((length, item) => length + item.length, 0), end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true); view.setUint32(12, directoryLength, true); view.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directoryLength + end.length); let cursor = 0;
  for (const bytes of [...locals, ...directory, end]) { result.set(bytes, cursor); cursor += bytes.length; }
  return result;
}

export function fixtureGlb(extra: Record<string, unknown> = {}): Uint8Array {
  const binary = new Uint8Array(76);
  new Float32Array(binary.buffer, 0, 9).set([-1, 0, 0, 1, 0, 0, 0, 3, 0]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
  new Float32Array(binary.buffer, 44, 2).set([0, 2]);
  new Float32Array(binary.buffer, 52, 6).set([0, 0, 0, .5, 0, 0]);
  const json = encoder.encode(JSON.stringify({ asset: { version: "2.0", generator: "asset package test fixture" }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: "NativeRoot", children: [1] }, { name: "NativeBody", mesh: 0 }],
    meshes: [{ name: "NativeTriangle", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: "NativeMaterial", doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [.4, .7, .5, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }, { buffer: 0, byteOffset: 44, byteLength: 8 }, { buffer: 0, byteOffset: 52, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, 0, 0], max: [1, 3, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [2] }, { bufferView: 3, componentType: 5126, count: 2, type: "VEC3" }],
    animations: [{ name: "Wait_Native", samplers: [{ input: 2, output: 3, interpolation: "LINEAR" }], channels: [{ sampler: 0, target: { node: 0, path: "translation" } }] }], ...extra }));
  const jsonLength = Math.ceil(json.length / 4) * 4, result = new Uint8Array(12 + 8 + jsonLength + 8 + binary.length), view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); result.fill(32, 20, 20 + jsonLength); result.set(json, 20);
  view.setUint32(20 + jsonLength, binary.length, true); view.setUint32(24 + jsonLength, 0x004e4942, true); result.set(binary, 28 + jsonLength);
  return result;
}
export function fixtureWav(): Uint8Array {
  const sampleRate = 8000, samples = 2000, result = new Uint8Array(44 + samples * 2), view = new DataView(result.buffer);
  result.set(encoder.encode("RIFF"), 0); view.setUint32(4, result.length - 8, true); result.set(encoder.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); result.set(encoder.encode("data"), 36); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * Math.PI * 2 * 440 / sampleRate) * 3000), true);
  return result;
}
export function fixturePng(): Uint8Array {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6;
  const row = [0, 80, 150, 100, 255], compressed = Uint8Array.from([0x78, 0x01, 0x01, 5, 0, 0xfa, 0xff, ...row, 0, 0, 0, 0]);
  let a = 1, b = 0; for (const value of row) { a = (a + value) % 65521; b = (b + a) % 65521; }
  new DataView(compressed.buffer).setUint32(compressed.length - 4, (b << 16) | a);
  const chunks = [["IHDR", header], ["IDAT", compressed], ["IEND", new Uint8Array()]] as const;
  const records = chunks.map(([type, bytes]) => {
    const record = new Uint8Array(12 + bytes.length), data = new DataView(record.buffer); data.setUint32(0, bytes.length); record.set(encoder.encode(type), 4); record.set(bytes, 8);
    data.setUint32(8 + bytes.length, crc32(record.subarray(4, 8 + bytes.length))); return record;
  });
  const result = new Uint8Array(signature.length + records.reduce((total, bytes) => total + bytes.length, 0)); result.set(signature); let offset = signature.length;
  for (const record of records) { result.set(record, offset); offset += record.length; }
  return result;
}
export async function assetFixture(kind: "model" | "audio" | "texture" = "model", patch: Partial<AssetPackageManifest> = {}) {
  const file = kind === "model" ? "model.glb" : kind === "audio" ? "sound.wav" : "texture.png";
  const bytes = kind === "model" ? fixtureGlb() : kind === "audio" ? fixtureWav() : fixturePng();
  const manifest: AssetPackageManifest = { schemaVersion: 1, id: `fixture-${kind}`, name: `Native ${kind} fixture`, kind,
    source: { edition: "interlude", package: "Fixture", object: "Fixture.Native", sha256: "a".repeat(64) },
    ...(kind === "model" ? { model: { file, unit: "metre" as const, sourceUnitsPerMetre: 100, sourceToGltf: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } } : kind === "audio" ? { audio: { file } } : { image: { file } }),
    files: [{ path: file, bytes: bytes.length, sha256: await sha256(bytes), mime: kind === "model" ? "model/gltf-binary" : kind === "audio" ? "audio/wav" : "image/png" }],
    limitations: ["Synthetic test fixture; not a game asset."], ...patch };
  const entries = [{ name: "asset.json", bytes: encoder.encode(JSON.stringify(manifest)) }, { name: file, bytes }];
  return { bytes: storedPackage(entries), manifest, entries };
}
