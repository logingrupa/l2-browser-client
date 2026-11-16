import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sourcePositionToWorld, worldPositionToSource, type WorldPosition } from "../../src/world/sourceFrame";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { routeTwoLaneStores } from "./support/twoLaneStoreRoutes";

const windowLaneName = "data-ui";
const tileLaneName = "world";
const nativeResourcePrefix = "/l2/";
const censusPath = resolve("docs/parts/minimap/minimap-join-census.json");
const evidenceDirectory = resolve("artifacts/ui-evidence");
const getLocInfoCaseTileId = "22_22";
const getLocInfoCaseZoneName = "Giran Castle Town";
const globalRadarTileId = "20_21";
const radarTextureMapBinding = { windowId: "NewRadarWnd", controlName: "texMap" };
const unresolvedMinimapReasons = ["minimap-join-unresolved:zone-title-source", "minimap-join-unresolved:radar-anchor", "texture-reference-unresolved",
  "presentation:view-origin-centred-on-marker"];

interface CensusMinimapControl { readonly windowId: string; readonly controlNames: readonly string[] }
interface LaneCatalogRecord { readonly id: string; readonly manifest: string }
interface LaneCatalog { readonly windows?: readonly LaneCatalogRecord[]; readonly tiles?: readonly LaneCatalogRecord[] }
interface PinnedArchive { readonly archive: string; readonly archiveSha256: string; readonly object?: string }
interface RealRoutePin { readonly manifest: string; readonly manifestSha256: string }
interface RealTileMinimap { readonly route: RealRoutePin; readonly zoneKeyTexture: PinnedArchive | null }
interface RealRouteManifest {
  readonly radar: { readonly cases: readonly { readonly zoneName: string; readonly texture: PinnedArchive | null }[];
    readonly default: { readonly texture: PinnedArchive | null } };
  readonly worldMap: { readonly pieces: readonly { readonly suffix: number; readonly texture: PinnedArchive | null }[];
    readonly projection: { readonly offsetX: number; readonly offsetY: number; readonly scaleNumerator: number; readonly scaleDenominator: number } };
}
interface RealTile { readonly tileId: string; readonly playerScenePosition: WorldPosition; readonly minimap: RealTileMinimap }
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

function censusMinimapWindow(windowId: string): CensusMinimapControl | null {
  const census = JSON.parse(readFileSync(censusPath, "utf8")) as { readonly minimapControls: readonly CensusMinimapControl[] };
  return census.minimapControls.find(entry => entry.windowId === windowId) ?? null;
}

function realLaneTile(tileId: string): RealTile | null {
  const record = readLaneCatalog(tileLaneName)?.tiles?.find(tile => tile.id === tileId);
  if (record === undefined) return null;
  const tileManifest = readLaneResource<{ readonly anchor: { readonly location: readonly [number, number, number] };
    readonly resources: readonly { readonly kind: string; readonly manifest: string }[] }>(tileLaneName, record.manifest);
  const resource = tileManifest.resources.find(entry => entry.kind === "minimap");
  if (resource === undefined) return null;
  const [x, y, z] = tileManifest.anchor.location;
  return { tileId, playerScenePosition: sourcePositionToWorld({ x, y, z }), minimap: readLaneResource<RealTileMinimap>(tileLaneName, resource.manifest) };
}

const minimapWindow = censusMinimapWindow("MinimapWnd");
const radarWindow = censusMinimapWindow(radarTextureMapBinding.windowId);
const windowLaneWindowIds = new Set(readLaneCatalog(windowLaneName)?.windows?.map(record => record.id) ?? []);
const caseTile = realLaneTile(getLocInfoCaseTileId);
const globalTile = realLaneTile(globalRadarTileId);
const routeManifest = caseTile === null ? null : readLaneResource<RealRouteManifest>(tileLaneName, caseTile.minimap.route.manifest);

function playerQuery(position: WorldPosition): string {
  return `&playerScenePosition=${[position.x, position.y, position.z].join(",")}`;
}

function minimapControlLocator(page: Page, windowEntry: CensusMinimapControl) {
  return page.locator(`[data-native-window=${JSON.stringify(windowEntry.windowId)}] [data-native-control=${JSON.stringify(windowEntry.controlNames[0])}]`);
}

async function openWindowAt(page: Page, windowEntry: CensusMinimapControl, tile: RealTile): Promise<void> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await routeTwoLaneStores(page, { windowLane: windowLaneName, tileLane: tileLaneName });
  await page.goto(`/tests/browser/harness/native-window.html?window=${encodeURIComponent(windowEntry.windowId)}${playerQuery(tile.playerScenePosition)}`);
  await expect(page.locator("#native-window-harness")).toHaveAttribute("data-status", /^(opened|not-in-catalog|failed)$/, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__nativeWindowHarness?.result.reason ?? null)).toBeNull();
  await expect(minimapControlLocator(page, windowEntry)).toHaveAttribute("data-native-minimap-state", "ready", { timeout: 30_000 });
  expect(pageErrors).toEqual([]);
}

async function expectImageDecoded(locator: ReturnType<Page["locator"]>): Promise<void> {
  await expect.poll(() => locator.evaluate(image => (image as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
}

function expectedMarkerMapPosition(tile: RealTile): { readonly mapX: number; readonly mapY: number } {
  const projection = routeManifest!.worldMap.projection;
  const source = worldPositionToSource(tile.playerScenePosition);
  const scale = projection.scaleNumerator / projection.scaleDenominator;
  return { mapX: Math.trunc((source.x + projection.offsetX) * scale), mapY: Math.trunc((source.y + projection.offsetY) * scale) };
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

async function expectRadarTexture(page: Page, tile: RealTile, textureObject: string, isGlobal: boolean): Promise<void> {
  await openWindowAt(page, radarWindow!, tile);
  const textureMap = page.locator(`[data-native-window=${JSON.stringify(radarTextureMapBinding.windowId)}] ` +
    `[data-native-control=${JSON.stringify(radarTextureMapBinding.controlName)}] [data-native-radar-texture-map]`);
  await expect(textureMap).toHaveAttribute("data-native-radar-texture", textureObject, { timeout: 30_000 });
  await expect(textureMap).toHaveAttribute("data-native-radar-is-global", String(isGlobal));
  await expect(textureMap).toHaveAttribute("data-native-gap", /minimap-join-unresolved:zone-title-source/);
  await expectImageDecoded(textureMap.locator("img"));
}

test.describe("MinimapCtrl and NewRadarWnd.texMap on the minimap route", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== tileLaneName, "run with NATIVE_STORE_ROOT=world");
  test.skip(minimapWindow === null || radarWindow === null, "the minimap census lists no MinimapWnd or NewRadarWnd MinimapCtrl control");
  test.skip(!windowLaneWindowIds.has("MinimapWnd") || !windowLaneWindowIds.has(radarTextureMapBinding.windowId),
    "the census minimap windows are not converted in the data-ui lane store");
  test.skip(caseTile === null || globalTile === null, `tiles ${getLocInfoCaseTileId} and ${globalRadarTileId} need a minimap resource in the world lane store`);

  for (const viewportCase of viewportCases) {
    test(`MinimapWnd draws the six world map pieces and the marker at the ${getLocInfoCaseTileId} anchor at ${viewportCase.name}`, async ({ browser }) => {
      await checkInNewPage(browser, viewportCase.options, async page => {
        await openWindowAt(page, minimapWindow!, caseTile!);
        const control = minimapControlLocator(page, minimapWindow!);
        const pieces = control.locator("[data-native-world-map-piece]");
        await expect(pieces).toHaveCount(routeManifest!.worldMap.pieces.length);
        expect(routeManifest!.worldMap.pieces.map(piece => piece.suffix)).toEqual([1, 2, 3, 4, 5, 6]);
        for (const suffix of [1, 2, 3, 4, 5, 6]) await expectImageDecoded(control.locator(`[data-native-world-map-piece="${suffix}"] img`));
        const marker = control.locator('[data-native-minimap-part="marker"]');
        const expected = expectedMarkerMapPosition(caseTile!);
        await expect(marker).toHaveAttribute("data-native-map-x", String(expected.mapX));
        await expect(marker).toHaveAttribute("data-native-map-y", String(expected.mapY));
        await expect(marker).toHaveAttribute("data-native-gap", "texture-reference-unresolved");
        await expect(control.locator('[data-native-minimap-part="zone-name"]')).toHaveAttribute("data-native-zone-name", getLocInfoCaseZoneName);
        const gaps = await page.evaluate(() => window.__nativeWindowHarness!.result.gaps.map(gap => gap.reason));
        expect(gaps).toEqual(expect.arrayContaining(unresolvedMinimapReasons));
        expect(gaps).not.toContain("control-type-unsupported:MinimapCtrl");
        await saveEvidenceScreenshot(page, `minimap-route-${getLocInfoCaseTileId}-${viewportCase.name}.png`);
      });
    });

    test(`NewRadarWnd.texMap shows the GetLocInfo texture of ${getLocInfoCaseZoneName} at the ${getLocInfoCaseTileId} anchor at ${viewportCase.name}`,
      async ({ browser }) => {
        const radarCase = routeManifest!.radar.cases.find(entry => entry.zoneName === getLocInfoCaseZoneName);
        expect(radarCase?.texture?.object).toBe("L2_RadarMap.RadarMaps.giran_castle_town");
        await checkInNewPage(browser, viewportCase.options, async page => {
          await expectRadarTexture(page, caseTile!, radarCase!.texture!.object!, false);
          await saveEvidenceScreenshot(page, `radar-texmap-${getLocInfoCaseTileId}-${viewportCase.name}.png`);
        });
      });

    test(`NewRadarWnd.texMap shows RadarMaps.Global at the ${globalRadarTileId} anchor at ${viewportCase.name}`, async ({ browser }) => {
      await checkInNewPage(browser, viewportCase.options, async page => {
        await expectRadarTexture(page, globalTile!, routeManifest!.radar.default.texture!.object!, true);
        await saveEvidenceScreenshot(page, `radar-texmap-${globalRadarTileId}-${viewportCase.name}.png`);
      });
    });
  }

  test("has no horizontal scroll at 430 x 932 portrait with the route world map", async ({ browser }) => {
    await checkInNewPage(browser, landscapePhone, async page => {
      await openWindowAt(page, minimapWindow!, caseTile!);
      await expectNoHorizontalScrollOnPortraitPhone(page);
    });
  });
});

test.describe("minimap route in the world lane store", () => {
  test.skip(caseTile === null, `tile ${getLocInfoCaseTileId} has no minimap resource in the world lane store`);

  test(`holds the route manifest and every texture archive that the ${getLocInfoCaseTileId} minimap pins`, () => {
    const route = caseTile!.minimap.route;
    const routeBytes = readLaneResourceBytes(tileLaneName, route.manifest);
    expect(sha256Hex(routeBytes)).toBe(route.manifestSha256);
    const archives = [...routeManifest!.radar.cases.map(entry => entry.texture), routeManifest!.radar.default.texture,
      ...routeManifest!.worldMap.pieces.map(piece => piece.texture), caseTile!.minimap.zoneKeyTexture].filter(texture => texture !== null);
    expect(archives.length).toBeGreaterThan(0);
    for (const texture of archives) expect(sha256Hex(readLaneResourceBytes(tileLaneName, texture!.archive))).toBe(texture!.archiveSha256);
  });
});
