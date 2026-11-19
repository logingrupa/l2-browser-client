import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDisplayGammaTable, defaultDisplayGammaSettings } from "../../src/materials/ue2/model/displayGamma";
import { desktopViewport } from "./browserViewports";

interface SkyCatalogRecord { readonly id: string; readonly manifest: string }
interface SkySnapshot {
  readonly parts: readonly { readonly sourceMaterial: string }[];
  readonly materials: readonly { readonly root: string; readonly program: { readonly programSha256: string } | null }[];
}
interface SkySurfaceInspection { readonly sourceReference: string | null; readonly status: string; readonly programMaterialId: string | null }
interface SkyEnvironmentColourWrite {
  readonly setupKey: string;
  readonly materialNode: string | null;
  readonly tableRgb: readonly number[] | null;
  readonly localFogInfoCount: number;
  readonly writtenRgb: readonly number[] | null;
  readonly materialColourSource: string;
  readonly reason: string | null;
}
interface CameraInspection { readonly target: number[]; readonly alpha: number; readonly upperBetaLimit: number | null; readonly lowerRadiusLimit: number | null }

const laneName = "world";
const tileId = "15_22";
const skyBackgroundRoot = "l2_skies.Shaders.SkybackgroundColor";
const laneStore = resolve("artifacts/lane-store", laneName, "l2");
const laneStoreFile = (path: string) => resolve(laneStore, path.replace(/^\/l2\//, ""));
const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const evidenceFolder = resolve("artifacts/ui-evidence");
const tileLoadTimeout = 300_000;
const displayGammaTable = buildDisplayGammaTable(defaultDisplayGammaSettings());
const colourByteMaximum = 255;
const displayedByte = (byte: number) => Math.round(displayGammaTable[byte]! * colourByteMaximum);

function sharedSkySnapshot(): SkySnapshot | null {
  const catalogPath = resolve(laneStore, "catalog.json");
  if (!existsSync(catalogPath)) return null;
  const record = readJson<{ skies?: SkyCatalogRecord[] }>(catalogPath).skies?.find(entry => entry.id === "skylevel");
  return record ? readJson<SkySnapshot>(laneStoreFile(record.manifest).replace(/manifest\.json$/, "sky.json")) : null;
}

const skySurfaces = (page: Page) => page.evaluate(() =>
  (window.__nativeSlice?.snapshot().nativeSky?.librarySurfaces ?? null) as SkySurfaceInspection[] | null);
const skyEnvironmentColourWrites = (page: Page) => page.evaluate(() =>
  (window.__nativeSlice?.snapshot().nativeSky?.environmentColours ?? []) as readonly SkyEnvironmentColourWrite[]);

async function lookAtHorizonFromTarget(page: Page): Promise<void> {
  await page.evaluate(() => {
    const slice = window.__nativeSlice!, camera = slice.snapshot().camera as CameraInspection;
    slice.setCameraPose!({ target: camera.target, alpha: camera.alpha, beta: camera.upperBetaLimit!, radius: camera.lowerRadiusLimit! });
  });
  await page.evaluate(() => new Promise<void>(resolveFrames => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrames()))));
}

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test(`draws the shared sky surfaces on tile ${tileId} through the UE2 library with the time-of-day background colour written into its ColorModifier at 1440 x 900`, async ({ page }) => {
    const snapshot = sharedSkySnapshot();
    test.skip(snapshot === null, "the world lane store has no shared skylevel sky; run scripts/world/shared_sky_step.py");
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
    const backgroundWrite = (await skyEnvironmentColourWrites(page)).find(write => write.materialNode?.toLowerCase() === skyBackgroundRoot.toLowerCase());
    expect(backgroundWrite, `${skyBackgroundRoot} is bound to a time-of-day sky colour`).toBeDefined();
    expect(backgroundWrite).toMatchObject({ materialColourSource: "environment-write", reason: null, localFogInfoCount: 0 });
    expect(backgroundWrite!.writtenRgb, `${skyBackgroundRoot} without a local L2FogInfo shows its time table colour`).toEqual(backgroundWrite!.tableRgb);
    mkdirSync(evidenceFolder, { recursive: true });
    await page.screenshot({ path: resolve(evidenceFolder, `world-sky-library-${tileId}-horizon-desktop.png`) });
    writeFileSync(resolve(evidenceFolder, `world-sky-library-${tileId}-inspection.json`), JSON.stringify({ librarySurfaces: await skySurfaces(page),
      backgroundWrite, backgroundDisplayedRgb: backgroundWrite!.writtenRgb!.map(displayedByte) }, null, 2));
    expect(pageErrors).toEqual([]);
  });
});
