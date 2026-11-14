import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { decodeNativeStorePng } from "../../src/assets/native/decodeNativeStorePng";
import { syntheticPngBytes } from "../support/syntheticPngBytes";

const signal = () => new AbortController().signal;

describe("the native store PNG decoder", () => {
  it("retains RGB beneath zero/partial alpha and independently reverses every PNG filter", async () => {
    const values = Uint8Array.from({ length: 4 * 3 * 5 }, (_, i) => (i * 71 + 13) % 256);
    values.set([191, 23, 54, 0, 9, 8, 7, 3]);
    const result = await decodeNativeStorePng(syntheticPngBytes(3, 5, 4, values, [0, 1, 2, 3, 4]), signal());
    expect(result).toMatchObject({ width: 3, height: 5 }); expect(result.rgba).toEqual(values);
    const rgb = await decodeNativeStorePng(syntheticPngBytes(1, 2, 3, new Uint8Array([7, 19, 31, 44, 55, 66]), [1, 4]), signal());
    expect([...rgb.rgba]).toEqual([7, 19, 31, 255, 44, 55, 66, 255]);
  });

  it("rejects unsupported layouts, decompressed length mismatches and cancellation", async () => {
    const bytes = syntheticPngBytes(2, 1, 4, new Uint8Array(8));
    for (const [offset, value] of [[24, 16], [25, 3], [28, 1]] as const) {
      const changed = bytes.slice(); changed[offset] = value;
      await expect(decodeNativeStorePng(changed, signal())).rejects.toThrow("supports only");
    }
    const dimensions = bytes.slice(); new DataView(dimensions.buffer).setUint32(16, 1);
    await expect(decodeNativeStorePng(dimensions, signal())).rejects.toThrow("exceeds dimensions");
    await expect(decodeNativeStorePng(bytes.slice(0, -1), signal())).rejects.toThrow();
    const abort = new AbortController(); abort.abort();
    await expect(decodeNativeStorePng(bytes, abort.signal)).rejects.toHaveProperty("name", "AbortError");
  });

  it("accepts every edge a WebGPU 2D texture takes on any adapter and refuses one pixel more", async () => {
    for (const edge of [1024, 1025, 2048, 8192]) {
      const row = new Uint8Array(edge * 3).fill(77);
      expect(await decodeNativeStorePng(syntheticPngBytes(edge, 1, 3, row), signal())).toMatchObject({ width: edge, height: 1 });
      expect(await decodeNativeStorePng(syntheticPngBytes(1, edge, 3, row), signal())).toMatchObject({ width: 1, height: edge });
    }
    await expect(decodeNativeStorePng(syntheticPngBytes(8193, 1, 3, new Uint8Array(8193 * 3)), signal())).rejects.toThrow("up to 8192 pixels per edge");
    await expect(decodeNativeStorePng(syntheticPngBytes(1, 8193, 3, new Uint8Array(8193 * 3)), signal())).rejects.toThrow("up to 8192 pixels per edge");
  });

  const localAudit = resolve("artifacts/native-parity/research/terrain-materials/texture-channel-audit.json"), migration = resolve("artifacts/native-parity/migration");
  it.skipIf(!existsSync(localAudit) || !existsSync(resolve(migration, "coverage.json")))("matches all 18 retained PNG channel-audit RGBA hashes", async () => {
    const audit = JSON.parse(readFileSync(localAudit, "utf8")) as { pngAudit: { results: { id: string; pngSha256: string; rgbaSha256: string }[] } };
    const jobs = JSON.parse(readFileSync(resolve(migration, "coverage.json"), "utf8")) as { jobs: { path?: string }[] };
    const expected = new Map(audit.pngAudit.results.map(row => [row.id, row])); let checked = 0;
    for (const job of jobs.jobs) {
      if (!job.path?.endsWith("asset.l2asset")) continue;
      const directory = dirname(resolve(migration, job.path));
      const asset = JSON.parse(readFileSync(resolve(directory, "asset.json"), "utf8")) as { id: string; kind: string; image?: { file: string } };
      const record = expected.get(asset.id);
      if (asset.kind !== "texture" || !asset.image || !record) continue;
      const bytes = new Uint8Array(readFileSync(resolve(directory, asset.image.file)));
      expect(await sha256(bytes)).toBe(record.pngSha256);
      const result = await decodeNativeStorePng(bytes, signal());
      expect(await sha256(result.rgba)).toBe(record.rgbaSha256); checked++;
    }
    expect(checked).toBe(18);
  });
});
