import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeNativeStorePng } from "../../src/assets/native/decodeNativeStorePng";
import { buildDisplayGammaTable, defaultDisplayGammaSettings } from "../../src/materials/ue2/model/displayGamma";
import { desktopViewport } from "./browserViewports";

interface TileCatalogRecord { readonly id: string; readonly manifest: string }
interface TileManifest { readonly resources: readonly { readonly kind: string; readonly manifest: string }[] }
interface SkySnapshot {
  readonly parts: readonly { readonly sourceMaterial: string; readonly authoredColorRGBA: readonly number[] }[];
  readonly materials: readonly { readonly root: string; readonly program: { readonly programSha256: string } | null }[];
}
interface SkySurfaceInspection { readonly sourceReference: string | null; readonly status: string; readonly programMaterialId: string | null }
interface CameraInspection { readonly target: number[]; readonly alpha: number; readonly upperBetaLimit: number | null; readonly lowerRadiusLimit: number | null }

const laneName = "world";
const tileId = "15_22";
const skyBackgroundRoot = "l2_skies.Shaders.SkybackgroundColor";
const laneStore = resolve("artifacts/lane-store", laneName, "l2");
const laneStoreFile = (path: string) => resolve(laneStore, path.replace(/^\/l2\//, ""));
const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const evidenceFolder = resolve("artifacts/ui-evidence");
const tileLoadTimeout = 300_000;
const skyRegion = { left: 300, right: 1100, top: 0, bottom: 200 };
const displayGammaTable = buildDisplayGammaTable(defaultDisplayGammaSettings());
const colourByteMaximum = 255;
const displayedByte = (byte: number) => Math.round(displayGammaTable[byte]! * colourByteMaximum);

function tileSkySnapshot(id: string): SkySnapshot | null {
  const catalogPath = resolve(laneStore, "catalog.json");
  if (!existsSync(catalogPath)) return null;
  const record = readJson<{ tiles?: TileCatalogRecord[] }>(catalogPath).tiles?.find(entry => entry.id === id);
  const sky = record ? readJson<TileManifest>(laneStoreFile(record.manifest)).resources.find(resource => resource.kind === "sky") : undefined;
  return sky ? readJson<SkySnapshot>(laneStoreFile(sky.manifest).replace(/manifest\.json$/, "sky.json")) : null;
}

const skySurfaces = (page: Page) => page.evaluate(() =>
  (window.__nativeSlice?.snapshot().nativeSky?.librarySurfaces ?? null) as SkySurfaceInspection[] | null);

async function lookAtHorizonFromTarget(page: Page): Promise<void> {
  await page.evaluate(() => {
    const slice = window.__nativeSlice!, camera = slice.snapshot().camera as CameraInspection;
    slice.setCameraPose!({ target: camera.target, alpha: camera.alpha, beta: camera.upperBetaLimit!, radius: camera.lowerRadiusLimit! });
  });
  await page.evaluate(() => new Promise<void>(resolveFrames => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrames()))));
}

function mostFrequentRegionColour(rgba: Uint8Array, width: number): readonly number[] {
  const counts = new Map<string, number>();
  for (let y = skyRegion.top; y < skyRegion.bottom; y++) {
    for (let x = skyRegion.left; x < skyRegion.right; x++) {
      const offset = (y * width + x) * 4, key = `${rgba[offset]},${rgba[offset + 1]},${rgba[offset + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]![0].split(",").map(Number);
}

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test(`draws tile ${tileId} sky surfaces through the UE2 library so its authored background colour passes the display gamma ramp once at 1440 x 900`, async ({ page }) => {
    const snapshot = tileSkySnapshot(tileId);
    test.skip(snapshot === null, `the world lane store has no tile ${tileId} sky; run the tile batch`);
    test.setTimeout(tileLoadTimeout + 60_000);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`/?map=${tileId}`);
    await expect.poll(async () => (await skySurfaces(page))?.length ?? 0, { timeout: tileLoadTimeout, intervals: [1_000] }).toBe(snapshot!.parts.length);
    const programOfRoot = new Map(snapshot!.materials.map(material => [material.root.toLowerCase(), material.program?.programSha256 ?? null]));
    for (const surface of (await skySurfaces(page))!) {
      expect(surface.status, `${surface.sourceReference} draws through the UE2 library`).toBe("library-compiled");
      expect(surface.programMaterialId).toBe(programOfRoot.get(surface.sourceReference!.toLowerCase()));
    }
    await lookAtHorizonFromTarget(page);
    mkdirSync(evidenceFolder, { recursive: true });
    const screenshot = await page.screenshot({ path: resolve(evidenceFolder, `world-sky-library-${tileId}-horizon-desktop.png`) });
    const pixels = await decodeNativeStorePng(new Uint8Array(screenshot), new AbortController().signal);
    const authored = snapshot!.parts.find(part => part.sourceMaterial === skyBackgroundRoot)!.authoredColorRGBA;
    const expected = authored.slice(0, 3).map(displayedByte);
    const measured = mostFrequentRegionColour(pixels.rgba, pixels.width);
    writeFileSync(resolve(evidenceFolder, `world-sky-library-${tileId}-inspection.json`),
      JSON.stringify({ librarySurfaces: await skySurfaces(page), authoredBackgroundRgba: authored, expectedDisplayedRgb: expected, measuredSkyRgb: measured }, null, 2));
    expect(measured).toEqual(expected);
    expect(pageErrors).toEqual([]);
  });
});
