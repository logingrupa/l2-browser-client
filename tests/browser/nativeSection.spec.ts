import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const catalogPath = resolve("public/l2/catalog.json");
const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, "utf8")) : null;
const sectionRecord = catalog?.sections?.find((row: { id: string }) => row.id === "map-20-20-section");
const staged = Boolean(sectionRecord);
const stagedBase = sectionRecord ? resolve("public", sectionRecord.manifest.slice(1), "../..") : "";
const sourceManifest = staged ? JSON.parse(readFileSync(resolve(stagedBase, "map-section-runtime/manifest.json"), "utf8")) : null;
const patchIdentity = {
  id: "interlude:20_20.TerrainInfo0.TerrainSector247", sourceTerrain: "20_20.TerrainInfo0",
  sourceSector: "20_20.TerrainInfo0.TerrainSector247", sourceMapSha256: "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4",
  gridBounds: [112, 240, 128, 255],
  model: { file: "terrain247.glb", bytes: 94512, sha256: "cee7f0f6eba0b62669cf3c1b2241c7671fa567ccbdfce2813633224fb238820a" },
  source: { file: "terrain247.json", bytes: 94169, sha256: "d104d12169b427238103689d7d37dfcca220bfe0702ec626e127a8cd064e9c2b" },
};
function terrainSources() {
  expect(sourceManifest.terrainPatches).toEqual([patchIdentity]);
  const resource = (entry: { file: string; bytes: number; sha256: string }) => {
    const bytes = readFileSync(resolve(stagedBase, "map-section", entry.file));
    expect(bytes.length).toBe(entry.bytes); expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    return bytes;
  };
  const geometry = (entry: { file: string; bytes: number; sha256: string }) => {
    const bytes = resource(entry);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67); expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length); expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
    const primitive = gltf.meshes[0].primitives[0], positions = gltf.accessors[primitive.attributes.POSITION];
    expect(primitive.attributes).toEqual({ POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TEXCOORD_1: 3 });
    return { vertices: positions.count as number, triangles: gltf.accessors[primitive.indices].count / 3,
      minimum: positions.min as number[], maximum: positions.max as number[] };
  };
  expect(sourceManifest.terrain).toMatchObject({ file: "terrain.glb", bytes: 376928,
    sha256: "39417edb0294885ef6bd4107c85a917f6dcc4dc2985d11393bb41afa2e63a724" });
  const base = geometry(sourceManifest.terrain), patch = geometry(patchIdentity.model);
  expect(base).toEqual({ vertices: 2352, triangles: 4512,
    minimum: [81.91999816894531, -36.090675354003906, 921.5999755859375], maximum: [143.36000061035156, -25.593175888061523, 981.760009765625] });
  expect(patch).toEqual({ vertices: 272, triangles: 480,
    minimum: [143.36000061035156, -31.352550506591797, 962.5599975585938], maximum: [163.83999633789062, -17.38458251953125, 981.760009765625] });
  resource(patchIdentity.source);
  return { base, patch, triangles: base.triangles + patch.triangles,
    minimum: base.minimum.map((value, index) => Math.min(value, patch.minimum[index]!)),
    maximum: base.maximum.map((value, index) => Math.max(value, patch.maximum[index]!)) };
}
const evidence = resolve(process.env.NATIVE_SECTION_EVIDENCE ?? "artifacts/native-parity/browser");
const snapshot = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSection) throw new Error("Native section inspector is missing.");
  return window.__nativeSection.snapshot();
});

test("native map section retains the declared source geometry, textured materials and exact placements", async ({ page }) => {
  test.skip(!staged, "Run pnpm assets:migrate --stage-runtime first.");
  test.setTimeout(240_000);
  const sourceTerrain = terrainSources();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/tests/browser/nativeSection.html");
  await page.waitForFunction(() => Boolean(window.__nativeSection), undefined, { timeout: 60_000 });
  await expect.poll(async () => (await snapshot(page)).ready, { timeout: 180_000 }).toBe(true);
  await expect.poll(async () => (await snapshot(page)).renders).toBeGreaterThan(10);
  const loaded = await snapshot(page);
  expect(loaded.failure).toBeNull(); expect(loaded.rightHanded).toBe(true);
  expect(await page.evaluate(() => window.__nativeSection!.settleGraphics()))
    .toEqual({ engine: "WebGPU", isWebGPU: true, context: true, errors: [] });
  expect(loaded.section).toMatchObject({ modelCount: sourceManifest.models.length, placementCount: sourceManifest.placements.length,
    terrainTriangles: sourceTerrain.triangles, finiteBounds: true, texturesReady: true,
    terrainMaterial: catalog.textures?.length ? "candidate-source-textures" : "neutral-inspection", materialFailure: null,
    collisionVerified: false, visualParity: "unverified" });
  expect(loaded.section!.textureCount).toBeGreaterThan(0);
  expect(loaded.section!.unsupportedRuntimeMaterials).toEqual(sourceManifest.unsupportedRuntimeMaterials ?? []);
  const terrain = loaded.section!.terrainBounds!;
  // Float32 renderer coordinates are compared in metres; this is not a visual acceptance tolerance.
  sourceTerrain.minimum.forEach((value, index) => expect(Math.abs(terrain.minimum[index]!-value)).toBeLessThan(.0001));
  sourceTerrain.maximum.forEach((value, index) => expect(Math.abs(terrain.maximum[index]!-value)).toBeLessThan(.0001));
  for (const placement of loaded.section!.placements) {
    expect(placement.meshes.length).toBeGreaterThan(0);
    expect(placement.meshes.every(mesh => mesh.material !== null)).toBe(true);
    placement.sourceMatrix.forEach((value, index) => expect(Math.abs(placement.worldMatrix[index]!-value)).toBeLessThan(.0001));
  }
  expect(loaded.camera.target[0]).toBeGreaterThan(0); expect(loaded.camera.target[2]).toBeGreaterThan(650);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "native-section-desktop.png") });
  await writeFile(resolve(evidence, "native-section-browser.json"), JSON.stringify({ ...loaded, sourceTerrain, errors }, null, 2));
  await page.getByRole("button", { name: "Unload section" }).click();
  const disposed = await snapshot(page);
  expect(disposed.section?.disposed).toBe(true);
  expect(disposed.current.meshes).toBe(disposed.before.meshes);
  expect(disposed.current.transformNodes).toBe(disposed.before.transformNodes);
  expect(disposed.current.materials).toBe(disposed.before.materials);
  expect(disposed.current.textures).toBe(disposed.before.textures);
  expect((await page.evaluate(() => window.__nativeSection!.settleGraphics())).errors).toEqual([]);
  expect(errors).toEqual([]);
});

for (const corrupted of [
  { name: "model", url: "**/map-section-models/**/model.glb" },
  { name: "terrain patch", url: "**/map-section/terrain247.glb" },
]) test(`native section ${corrupted.name} hash failure rolls back its partial load`, async ({ page }) => {
  test.skip(!staged, "Run pnpm assets:migrate --stage-runtime first.");
  test.setTimeout(120_000);
  await page.route(corrupted.url, route => route.fulfill({ status: 200, contentType: "model/gltf-binary", body: "corrupt source fixture" }));
  await page.goto("/tests/browser/nativeSection.html");
  await expect(page.locator("#section-status")).toContainText("hash/length mismatch", { timeout: 90_000 });
  const result = await snapshot(page);
  expect(result.ready).toBe(false);
  expect(result.current.meshes).toBe(result.before.meshes);
  expect(result.current.transformNodes).toBe(result.before.transformNodes);
  expect(result.current.materials).toBe(result.before.materials);
  expect(result.current.textures).toBe(result.before.textures);
  expect(await page.evaluate(() => window.__nativeSection!.settleGraphics()))
    .toEqual({ engine: "WebGPU", isWebGPU: true, context: true, errors: [] });
});
