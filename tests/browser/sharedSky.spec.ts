import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";

interface SkyCatalogRecord { readonly id: string; readonly manifest: string; readonly manifestSha256: string }
interface SkyBundleManifest { readonly id: string; readonly counts: { readonly materialRoots: number } }
interface SkySurfaceInspection { readonly sourceReference: string | null; readonly status: string }
interface SkyVisibilityInspection { readonly drawn: boolean; readonly acceptedNodes: number; readonly runs: number; readonly runParts: readonly number[] }

const laneName = "world";
const skyKey = "map:skylevel";
const laneFolder = resolve("artifacts/lane-store", laneName);
const laneStoreFile = (manifest: string) => resolve(laneFolder, "l2", manifest.replace(/^\/l2\//, ""));
const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const laneCatalogPath = resolve(laneFolder, "l2/catalog.json");
const laneCatalog: { skies?: SkyCatalogRecord[] } | null = existsSync(laneCatalogPath) ? readJson(laneCatalogPath) : null;
const skyRecord = laneCatalog?.skies?.find(record => record.id === "skylevel") ?? null;
const tileLoadTimeout = 300_000;
const terminalColourCodes = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(skyRecord === null, "the world lane catalog has no skies record skylevel; run scripts/world/shared_sky_step.py --client E:/Lineage2-client");

let laneCatalogSha256: string | null = null;
let firstFailureReason: string | null = null;

test.beforeEach(async ({ baseURL }) => {
  if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
  laneCatalogSha256 = await servedLaneCatalogSha256(baseURL);
});

test.afterEach(async ({}, testInfo: TestInfo) => {
  if (testInfo.status === "skipped" || laneCatalogSha256 === null) return;
  if (testInfo.status !== "passed") {
    const message = (testInfo.errors[0]?.message ?? "").replace(terminalColourCodes, "").split("\n")[0]!.trim();
    firstFailureReason ??= message || `shared sky check ${testInfo.status}`;
  }
  writeLoadCheckRecord(laneName, laneCatalogSha256, {
    key: skyKey, status: firstFailureReason === null ? "pass" : "failed", reason: firstFailureReason,
    atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: null,
  });
});

const skySnapshot = (page: Page) => page.evaluate(() => {
  const snapshot = window.__nativeSlice!.snapshot();
  return { sky: snapshot.nativeSky ?? null, failure: snapshot.skyFailure ?? null };
});

async function openSharedSky(page: Page, tileId: string, screenshotName: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/?map=${tileId}`);
  const startup = () => page.evaluate(() => {
    const loading = document.querySelector<HTMLElement>("#loading");
    if (!loading) return window.__nativeSlice ? "ready" : "loading";
    return loading.dataset.state === "error" ? `error: ${(loading.textContent ?? "").replace(/\s+/g, " ").trim()}` : "loading";
  });
  await expect.poll(startup, { timeout: tileLoadTimeout, intervals: [1_000] }).toMatch(/^(ready|error)/);
  const state = await startup();
  if (state !== "ready") throw new Error(`tile:${tileId} did not start on the native route: ${state}`);
  await expect.poll(async () => {
    const { sky, failure } = await skySnapshot(page);
    return failure ?? (sky?.texturesReady === true ? "ready" : "loading");
  }, { timeout: tileLoadTimeout, intervals: [1_000] }).not.toBe("loading");
  const bundle = readJson<SkyBundleManifest>(laneStoreFile(skyRecord!.manifest));
  const { sky, failure } = await skySnapshot(page);
  expect(failure).toBeNull();
  expect(sky).toMatchObject({ status: "shared-sky", sourceId: bundle.id, manifestSha256: skyRecord!.manifestSha256, meshes: bundle.counts.materialRoots,
    drawGate: "fakebackdrop-trigger" });
  expect(sky!.gaps).toEqual(expect.arrayContaining(["shared-sky-viewport160-unresolved", "shared-sky-matrix-construction-unreplayed"]));
  expect(sky!.gaps).not.toContain("shared-sky-view-gate-unresolved");
  expect(sky!.gaps).not.toContain("shared-sky-visibility-unstaged");
  const visibility = sky!.skyVisibility as SkyVisibilityInspection | null;
  if (sky!.drawn === true) {
    expect(sky!.triggerNode).toBeGreaterThanOrEqual(0);
    expect(visibility).toMatchObject({ drawn: true });
    expect(visibility!.runParts).toHaveLength(visibility!.runs);
  }
  const sourceReferences = (sky!.librarySurfaces as readonly SkySurfaceInspection[]).map(surface => surface.sourceReference?.toLowerCase());
  expect(sourceReferences).toHaveLength(7);
  expect(sourceReferences).not.toContain("l2_skies.shaders.starfield_final02");
  expect(sourceReferences).not.toContain("l2_skies.shaders.cloud_final");
  await page.screenshot({ path: `test-results/${screenshotName}` });
  expect(pageErrors).toEqual([]);
}

for (const tileId of ["20_21", "15_22"]) {
  test.describe(`desktop ${tileId}`, () => {
    test.use({ viewport: desktopViewport });
    test(`presents the one shared skylevel sky on tile ${tileId} at 1440 x 900`, async ({ page }) => {
      test.setTimeout(2 * tileLoadTimeout + 60_000);
      await openSharedSky(page, tileId, `shared-sky-${tileId}-desktop.png`);
    });
  });
}

test.describe("phone", () => {
  test.use(landscapePhone);
  test("presents the shared sky on tile 20_21 at 932 x 430 landscape with touch and has no horizontal scroll in portrait", async ({ page, hasTouch, isMobile }) => {
    test.setTimeout(2 * tileLoadTimeout + 60_000);
    expect({ hasTouch, isMobile }).toEqual({ hasTouch: true, isMobile: true });
    await openSharedSky(page, "20_21", "shared-sky-20_21-phone-landscape.png");
    await expectNoHorizontalScrollOnPortraitPhone(page);
  });
});
