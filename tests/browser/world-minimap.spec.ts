import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sourcePositionToWorld } from "../../src/world/sourceFrame";
import type { WorldPosition } from "../../src/world/sourceFrame";
import { syntheticTileFrameCentreScene, syntheticZoneTitleGapReason } from "../fixtures/tileMinimapManifestFixture";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { syntheticMinimapTiles, type SyntheticMinimapTiles } from "./support/syntheticMinimapTiles";
import { routeTwoLaneStores } from "./support/twoLaneStoreRoutes";

const windowLaneName = "data-ui";
const tileLaneName = "world";
const nativeResourcePrefix = "/l2/";
const censusPath = resolve("docs/parts/minimap/minimap-join-census.json");
const evidenceDirectory = resolve("artifacts/ui-evidence");
const noConvertedTileReason = "no converted tile at the player position";
const unsupportedMinimapReason = "control-type-unsupported:MinimapCtrl";
const notInCatalogReason = "tile minimap resource not in catalog";
const realTileId = "20_21";
const syntheticRadarTileId = "20_21";
const syntheticRadarGapTileId = "21_21";

interface CensusMinimapControl { readonly windowId: string; readonly controlNames: readonly string[] }
interface LaneCatalogRecord { readonly id: string; readonly manifest: string }
interface LaneCatalog { readonly windows?: readonly LaneCatalogRecord[]; readonly tiles?: readonly LaneCatalogRecord[] }
interface PinnedArchive { readonly archive: string; readonly archiveSha256: string }
interface RealRoutePin { readonly manifest: string; readonly manifestSha256: string }
interface RealTileMinimap {
  readonly projection: unknown;
  readonly route: RealRoutePin;
  readonly zoneKeyTexture: PinnedArchive | null;
  readonly gaps: readonly { readonly reason: string }[];
}
interface RealRouteManifest {
  readonly radar: { readonly cases: readonly { readonly texture: PinnedArchive | null }[]; readonly default: { readonly texture: PinnedArchive | null } };
  readonly worldMap: { readonly pieces: readonly { readonly texture: PinnedArchive | null }[] };
}
interface RealTile { readonly playerScenePosition: WorldPosition; readonly minimap: RealTileMinimap }
interface ViewportCase { readonly name: string; readonly options: BrowserContextOptions }

const viewportCases: readonly ViewportCase[] = [
  { name: "932x430", options: landscapePhone },
  { name: "1440x900", options: { viewport: desktopViewport } },
];

function laneStoreRoot(laneName: string): string {
  return resolve("artifacts/lane-store", laneName, "l2");
}

function readLaneCatalog(laneName: string): LaneCatalog | null {
  const catalogPath = resolve(laneStoreRoot(laneName), "catalog.json");
  return existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, "utf8")) as LaneCatalog : null;
}

function readLaneResourceBytes(laneName: string, path: string): Buffer {
  return readFileSync(resolve(laneStoreRoot(laneName), path.slice(nativeResourcePrefix.length)));
}

function readLaneResource<Resource>(laneName: string, path: string): Resource {
  return JSON.parse(readLaneResourceBytes(laneName, path).toString("utf8")) as Resource;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function firstCensusMinimapWindow(): CensusMinimapControl | null {
  const census = JSON.parse(readFileSync(censusPath, "utf8")) as { readonly minimapControls: readonly CensusMinimapControl[] };
  return census.minimapControls[0] ?? null;
}

function realLaneTile(): RealTile | null {
  const record = readLaneCatalog(tileLaneName)?.tiles?.find(tile => tile.id === realTileId);
  if (record === undefined) return null;
  const tileManifest = readLaneResource<{ readonly anchor: { readonly location: readonly [number, number, number] };
    readonly resources: readonly { readonly kind: string; readonly manifest: string }[] }>(tileLaneName, record.manifest);
  const resource = tileManifest.resources.find(entry => entry.kind === "minimap");
  if (resource === undefined) return null;
  const minimap = readLaneResource<RealTileMinimap & { readonly projection: { readonly frameMinimumNative: readonly number[];
    readonly frameMaximumNative: readonly number[] } | null }>(tileLaneName, resource.manifest);
  const [anchorX, anchorY, anchorZ] = tileManifest.anchor.location;
  const nativePosition = minimap.projection === null ? { x: anchorX, y: anchorY, z: anchorZ } : {
    x: (minimap.projection.frameMinimumNative[0]! + minimap.projection.frameMaximumNative[0]!) / 2,
    y: (minimap.projection.frameMinimumNative[1]! + minimap.projection.frameMaximumNative[1]!) / 2, z: anchorZ };
  return { playerScenePosition: sourcePositionToWorld(nativePosition), minimap };
}

const minimapWindow = firstCensusMinimapWindow();
const windowLaneHoldsMinimapWindow = minimapWindow !== null && (readLaneCatalog(windowLaneName)?.windows?.some(record => record.id === minimapWindow.windowId) ?? false);
const realTile = realLaneTile();

function playerQuery(position: WorldPosition): string {
  return `&playerScenePosition=${[position.x, position.y, position.z].join(",")}`;
}

async function openMinimapWindow(page: Page, query: string): Promise<void> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/tests/browser/harness/native-window.html?window=${encodeURIComponent(minimapWindow!.windowId)}${query}`);
  await expect(page.locator("#native-window-harness")).toHaveAttribute("data-status", /^(opened|not-in-catalog|failed)$/, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__nativeWindowHarness?.result.reason ?? null)).toBeNull();
  await expect(minimapControlLocator(page)).toHaveAttribute("data-native-minimap-state", /^(ready|failed)$/, { timeout: 30_000 });
  expect(pageErrors).toEqual([]);
}

function minimapControlLocator(page: Page) {
  return page.locator(`[data-native-window=${JSON.stringify(minimapWindow!.windowId)}] [data-native-control=${JSON.stringify(minimapWindow!.controlNames[0])}]`);
}

function minimapTileLocator(page: Page, tileId: string) {
  return minimapControlLocator(page).locator(`[data-native-minimap-tile=${JSON.stringify(tileId)}]`);
}

async function expectMarkerInsideControl(page: Page): Promise<void> {
  const marker = minimapControlLocator(page).locator('[data-native-minimap-part="marker"]');
  await expect(marker).toHaveAttribute("data-native-status", "unverified");
  await expect(marker).toHaveAttribute("data-native-gap", "texture-reference-unresolved");
  const [markerRectangle, controlRectangle] = await Promise.all([
    marker.evaluate(element => element.getBoundingClientRect().toJSON() as DOMRect),
    minimapControlLocator(page).evaluate(element => element.getBoundingClientRect().toJSON() as DOMRect)]);
  expect(markerRectangle.left).toBeGreaterThan(controlRectangle.left);
  expect(markerRectangle.left).toBeLessThan(controlRectangle.right);
  expect(markerRectangle.top).toBeGreaterThan(controlRectangle.top);
  expect(markerRectangle.top).toBeLessThan(controlRectangle.bottom);
}

async function routeSyntheticTiles(page: Page, synthetic: SyntheticMinimapTiles): Promise<void> {
  const windowCatalog = readLaneCatalog(windowLaneName)!;
  const catalogBody = JSON.stringify({ ...windowCatalog, tiles: synthetic.tiles });
  await page.route(url => url.pathname.startsWith(nativeResourcePrefix), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/l2/catalog.json") return route.fulfill({ status: 200, contentType: "application/json", body: catalogBody });
    const resource = synthetic.resources.get(path);
    if (resource !== undefined) return route.fulfill({ status: 200, body: Buffer.from(resource) });
    return route.fallback();
  });
}

async function checkInNewPage(browser: Browser, options: BrowserContextOptions, check: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext(options);
  try { await check(await context.newPage()); }
  finally { await context.close(); }
}

async function saveEvidenceScreenshot(page: Page, name: string): Promise<void> {
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDirectory, name) });
}

test.describe("MinimapCtrl from the decoded interface", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== windowLaneName, "run with NATIVE_STORE_ROOT=data-ui");
  test.skip(minimapWindow === null, "the minimap census lists no window with a MinimapCtrl control");
  test.skip(!windowLaneHoldsMinimapWindow, "the census MinimapCtrl window is not converted in the data-ui lane store");

  test("renders the control and shows the sourced gap when the served catalog holds no tile minimap", async ({ page }) => {
    await openMinimapWindow(page, "");
    const control = minimapControlLocator(page);
    await expect(control).toHaveAttribute("data-native-type", "MinimapCtrl");
    await expect(control).not.toHaveAttribute("data-native-gap", new RegExp(unsupportedMinimapReason));
    await expect(control).toHaveAttribute("data-native-minimap-state", "ready");
    await expect(control.locator(`[data-native-gap=${JSON.stringify(noConvertedTileReason)}]`)).toHaveCount(1);
    await expect(control.locator('[data-native-minimap-part="marker"]')).toHaveCount(0);
    const gaps = await page.evaluate(() => window.__nativeWindowHarness!.result.gaps.map(gap => gap.reason));
    expect(gaps).not.toContain(unsupportedMinimapReason);
  });

  for (const viewportCase of viewportCases) {
    test(`draws the tile grid around the player from synthetic tile fixtures at ${viewportCase.name}`, async ({ browser }) => {
      const synthetic = await syntheticMinimapTiles([syntheticRadarTileId], [syntheticRadarGapTileId]);
      await checkInNewPage(browser, viewportCase.options, async page => {
        await routeSyntheticTiles(page, synthetic);
        await openMinimapWindow(page, playerQuery(syntheticTileFrameCentreScene(syntheticRadarTileId)));
        const radarCell = minimapTileLocator(page, syntheticRadarTileId);
        await expect(radarCell).toHaveAttribute("data-native-minimap-cell", "texture");
        await expect.poll(() => radarCell.locator("img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expect(minimapTileLocator(page, syntheticRadarGapTileId)).toHaveAttribute("data-native-gap", syntheticZoneTitleGapReason);
        await expect(minimapControlLocator(page).locator(`[data-native-gap=${JSON.stringify(notInCatalogReason)}]`).first()).toBeAttached();
        await expect(minimapControlLocator(page)).toHaveAttribute("data-native-minimap-arrangement", "tile-grid, unverified");
        await expectMarkerInsideControl(page);
        await saveEvidenceScreenshot(page, `minimap-synthetic-${viewportCase.name}.png`);
      });
    });
  }

  test("has no horizontal scroll at 430 x 932 portrait with the synthetic tile grid", async ({ browser }) => {
    const synthetic = await syntheticMinimapTiles([syntheticRadarTileId], [syntheticRadarGapTileId]);
    await checkInNewPage(browser, landscapePhone, async page => {
      await routeSyntheticTiles(page, synthetic);
      await openMinimapWindow(page, playerQuery(syntheticTileFrameCentreScene(syntheticRadarTileId)));
      await expectNoHorizontalScrollOnPortraitPhone(page);
    });
  });
});

test.describe("MinimapCtrl over the data-ui and world lane stores", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== windowLaneName, "run with NATIVE_STORE_ROOT=data-ui");
  test.skip(!windowLaneHoldsMinimapWindow, "the census MinimapCtrl window is not converted in the data-ui lane store");
  test.skip(realTile === null, `tile ${realTileId} has no minimap resource in the world lane store`);

  test(`shows the ${realTileId} radar texture cell and the marker`, async ({ browser }) => {
    test.skip(realTile!.minimap.projection === null,
      `tile ${realTileId} minimap has no radar projection: ${realTile!.minimap.gaps.map(gap => gap.reason).join(" ")}`);
    for (const viewportCase of viewportCases) {
      await checkInNewPage(browser, viewportCase.options, async page => {
        await routeTwoLaneStores(page, { windowLane: windowLaneName, tileLane: tileLaneName });
        await openMinimapWindow(page, playerQuery(realTile!.playerScenePosition));
        await expect(minimapTileLocator(page, realTileId)).toHaveAttribute("data-native-minimap-cell", "texture");
        await expectMarkerInsideControl(page);
        await saveEvidenceScreenshot(page, `minimap-${realTileId}-${viewportCase.name}.png`);
      });
    }
  });

  test(`shows the sourced gap state at the ${realTileId} anchor while its radar texture is unresolved`, async ({ browser }) => {
    test.skip(realTile!.minimap.projection !== null, `tile ${realTileId} minimap has a radar projection`);
    for (const viewportCase of viewportCases) {
      await checkInNewPage(browser, viewportCase.options, async page => {
        await routeTwoLaneStores(page, { windowLane: windowLaneName, tileLane: tileLaneName });
        await openMinimapWindow(page, playerQuery(realTile!.playerScenePosition));
        const control = minimapControlLocator(page);
        await expect(control).toHaveAttribute("data-native-minimap-state", "ready");
        await expect(control.locator('[data-native-minimap-part="state"]')).toHaveAttribute("data-native-gap", noConvertedTileReason);
        await expect(control.locator('[data-native-minimap-part="marker"]')).toHaveCount(0);
        await saveEvidenceScreenshot(page, `minimap-${realTileId}-gap-${viewportCase.name}.png`);
      });
    }
    await checkInNewPage(browser, landscapePhone, async page => {
      await routeTwoLaneStores(page, { windowLane: windowLaneName, tileLane: tileLaneName });
      await openMinimapWindow(page, playerQuery(realTile!.playerScenePosition));
      await expectNoHorizontalScrollOnPortraitPhone(page);
    });
  });
});

test.describe("minimap route in the world lane store", () => {
  test.skip(realTile === null, `tile ${realTileId} has no minimap resource in the world lane store`);

  test(`holds the route manifest and every texture archive that the ${realTileId} minimap pins`, () => {
    const route = realTile!.minimap.route;
    const routeBytes = readLaneResourceBytes(tileLaneName, route.manifest);
    expect(sha256Hex(routeBytes)).toBe(route.manifestSha256);
    const routeManifest = JSON.parse(routeBytes.toString("utf8")) as RealRouteManifest;
    const archives = [...routeManifest.radar.cases.map(entry => entry.texture), routeManifest.radar.default.texture,
      ...routeManifest.worldMap.pieces.map(piece => piece.texture), realTile!.minimap.zoneKeyTexture].filter(texture => texture !== null);
    expect(archives.length).toBeGreaterThan(0);
    for (const texture of archives) expect(sha256Hex(readLaneResourceBytes(tileLaneName, texture!.archive))).toBe(texture!.archiveSha256);
  });
});
