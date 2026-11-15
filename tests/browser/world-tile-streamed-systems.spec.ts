import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";

interface TileCatalogRecord { readonly id: string; readonly manifest: string }
interface TileManifestFile {
  readonly resources: readonly { readonly kind: string }[];
  readonly chunks: readonly { readonly chunkId: string; readonly manifest: string }[];
}
interface PlanarPoint { readonly x: number; readonly z: number }
interface StreamedTarget { readonly tileId: string; readonly chunkId: string; readonly cellId: string }

const laneName = "world";
const laneRoot = resolve("artifacts/lane-store", laneName);
const laneCatalogPath = join(laneRoot, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? JSON.parse(readFileSync(laneCatalogPath, "utf8")) : null;
const tilesWithOwnChunksBeyondStartupRing = ["18_24", "18_10", "20_10", "18_22", "19_16"];
const tileWithNeighbourChunksBeyondStartupRing = "20_21";
const startTileIds = [...tilesWithOwnChunksBeyondStartupRing, tileWithNeighbourChunksBeyondStartupRing]
  .filter(tileId => laneCatalog?.tiles?.some(record => record.id === tileId) ?? false);
const readLaneJson = <Value>(servedPath: string): Value => JSON.parse(readFileSync(join(laneRoot, servedPath), "utf8")) as Value;

function bspCellIdsOfLitAndCulledTile(record: TileCatalogRecord): readonly string[] {
  const manifest = readLaneJson<TileManifestFile>(record.manifest);
  const kinds = new Set(manifest.resources.map(resource => resource.kind));
  if (!kinds.has("lighting") || !kinds.has("bsp-visibility")) return [];
  return manifest.chunks.filter(chunk => readLaneJson<{ bsp: unknown }>(chunk.manifest).bsp !== null).map(chunk => `${record.id}/${chunk.chunkId}`);
}

const bspCellIdsOfLitAndCulledTiles = (laneCatalog?.tiles ?? []).flatMap(bspCellIdsOfLitAndCulledTile);
const tileLoadTimeout = 240_000;
const hopTimeout = 60_000;
const hopMetres = 8;
const perpendicularOffsetsMetres = [0, 8, -8, 16, -16];
const minimumHopProgressMetres = 1;
const maximumHops = 60;
const chunksPerTileEdge = 4;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(startTileIds.length === 0, "the world lane holds none of 18_24, 18_10, 20_10, 18_22, 19_16 or 20_21");

function globalChunkPosition(cellId: string): [number, number] {
  const [tileId, chunkId] = cellId.split("/") as [string, string];
  const [tileColumn, tileRow] = tileId.split("_").map(Number) as [number, number];
  const [chunkColumn, chunkRow] = chunkId.split("-").slice(1).map(Number) as [number, number];
  return [tileColumn * chunksPerTileEdge + chunkColumn, tileRow * chunksPerTileEdge + chunkRow];
}

const streamedSnapshot = (page: Page) => page.evaluate(() => {
  const value = window.__nativeSlice!.snapshot();
  const player = value.entities.find(entity => entity.id === "local-player")!;
  const pawn = value.movement?.presenter.pawns.find(entry => entry.entityId === "local-player") ?? null;
  const world = value.world;
  const lighting = world?.lighting ?? null, visibility = world?.bspVisibility ?? null;
  return { position: player.position, pawn, collisionStatus: value.collisionCells?.status ?? null, residency: world?.residency ?? null,
    lightingSections: lighting !== null && lighting.gap === null ? lighting.sections.map(section => ({ chunkId: section.chunkId, lighting: section.lighting })) : [],
    visibilityGap: visibility === null ? "visibility-inspection-absent" : visibility.gap,
    limitRules: visibility !== null && visibility.gap === null ? visibility.limitRules : [], streamedTiles: world?.streamedTiles ?? [] };
});

async function openTile(page: Page, tileId: string) {
  await page.goto(`/?map=${tileId}`);
  const startup = () => page.evaluate(() => {
    const loading = document.querySelector<HTMLElement>("#loading");
    if (loading?.dataset.state === "error") return `error: ${(loading.textContent ?? "").replace(/\s+/g, " ").trim()}`;
    return document.body.dataset.worldState === "ready" && window.__nativeSlice !== undefined ? "ready" : "loading";
  });
  await expect.poll(startup, { timeout: tileLoadTimeout, intervals: [1_000] }).toMatch(/^(ready|error)/);
  const state = await startup();
  if (state !== "ready") return state;
  await expect.poll(async () => (await streamedSnapshot(page)).collisionStatus, { timeout: tileLoadTimeout, intervals: [1_000] }).toBe("resident");
  return streamedSnapshot(page);
}

function nearestChunkBeyondStartupRing(startup: Awaited<ReturnType<typeof streamedSnapshot>>): StreamedTarget | null {
  const residency = startup.residency!;
  const loadableTileIds = new Set(residency.loadedCellIds.map(cellId => cellId.split("/")[0]!));
  const focus = globalChunkPosition(residency.focusCellIds[0]!);
  const distance = (cellId: string) => { const [column, row] = globalChunkPosition(cellId); return Math.hypot(column - focus[0], row - focus[1]); };
  const candidates = bspCellIdsOfLitAndCulledTiles.filter(cellId => loadableTileIds.has(cellId.split("/")[0]!) && !residency.loadedCellIds.includes(cellId))
    .sort((left, right) => distance(left) - distance(right) || (left < right ? -1 : 1));
  const cellId = candidates[0];
  if (cellId === undefined) return null;
  const [tileId, chunkId] = cellId.split("/") as [string, string];
  return { tileId, chunkId, cellId };
}

async function openTileWithChunkBeyondStartupRing(page: Page, pageErrors: string[]) {
  const skippedTiles: string[] = [];
  for (const tileId of startTileIds) {
    pageErrors.length = 0;
    const startup = await openTile(page, tileId);
    if (typeof startup === "string") { skippedTiles.push(`${tileId}: ${startup}`); continue; }
    if (startup.residency === null) throw new Error(`${tileId} reported no residency inspection on the streamed route`);
    const target = nearestChunkBeyondStartupRing(startup);
    if (target === null) { skippedTiles.push(`${tileId}: every lit BSP chunk of its loadable tiles is resident at startup`); continue; }
    return { startTileId: tileId, target, startup, skippedTiles };
  }
  throw new Error(`no start tile leaves a lit BSP chunk unloaded at startup: ${skippedTiles.join("; ")}`);
}

async function walkOneHop(page: Page, direction: PlanarPoint) {
  const start = await streamedSnapshot(page);
  const from = { x: start.position.x, z: start.position.z };
  const attempts: string[] = [];
  for (const offsetMetres of perpendicularOffsetsMetres) {
    const to = { x: from.x + direction.x * hopMetres - direction.z * offsetMetres, z: from.z + direction.z * hopMetres + direction.x * offsetMetres };
    const heights = await page.evaluate(({ x, z }) => window.__nativeSlice!.collisionSurfaceHeightsAt!(x, z), to);
    if (heights.length === 0) { attempts.push(`${offsetMetres} m: no collision surface`); continue; }
    const height = heights.reduce((nearest, candidate) => Math.abs(candidate - start.position.y) < Math.abs(nearest - start.position.y) ? candidate : nearest);
    await page.evaluate(position => window.__nativeSlice!.dispatch({ type: "move-local", position }), { x: to.x, y: height, z: to.z });
    await expect.poll(async () => (await streamedSnapshot(page)).pawn?.isMoving ?? true, { timeout: hopTimeout, intervals: [250] }).toBe(false);
    const end = await streamedSnapshot(page);
    const progress = (end.position.x - from.x) * direction.x + (end.position.z - from.z) * direction.z;
    if (progress >= minimumHopProgressMetres) return;
    attempts.push(`${offsetMetres} m: ${progress.toFixed(2)} m progress, held ${end.pawn?.heldReason ?? "no pawn"}`);
  }
  throw new Error(`blocked hop from ${from.x.toFixed(2)}, ${from.z.toFixed(2)}: ${attempts.join("; ")}`);
}

async function walkIntoChunk(page: Page, target: StreamedTarget) {
  const [targetColumn, targetRow] = globalChunkPosition(target.cellId);
  for (let hop = 0; hop < maximumHops; hop += 1) {
    const now = await streamedSnapshot(page);
    if (now.residency!.focusCellIds.includes(target.cellId)) return hop;
    const [focusColumn, focusRow] = globalChunkPosition(now.residency!.focusCellIds[0]!);
    const length = Math.hypot(targetColumn - focusColumn, targetRow - focusRow);
    try { await walkOneHop(page, { x: (targetColumn - focusColumn) / length, z: (targetRow - focusRow) / length }); }
    catch (error) { if (now.residency!.loadedCellIds.includes(target.cellId)) return hop; throw error; }
  }
  throw new Error(`the walk did not reach ${target.cellId} within ${maximumHops} hops`);
}

const targetSystems = (snapshot: Awaited<ReturnType<typeof streamedSnapshot>>, target: StreamedTarget) =>
  snapshot.streamedTiles.find(tile => tile.tileId === target.tileId)?.systems ?? null;

async function checkChunkStreamedAfterStartup(page: Page, evidenceName: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const { startTileId, target, startup, skippedTiles } = await openTileWithChunkBeyondStartupRing(page, pageErrors);
  expect(startup.residency!.loadedCellIds).not.toContain(target.cellId);
  expect(targetSystems(startup, target)?.lighting?.lightmappedChunkIds ?? []).not.toContain(target.chunkId);
  expect(targetSystems(startup, target)?.visibility?.targetChunkIds ?? []).not.toContain(target.chunkId);
  const hops = await walkIntoChunk(page, target);
  await expect.poll(async () => {
    const now = await streamedSnapshot(page), systems = targetSystems(now, target);
    return { resident: now.residency!.loadedCellIds.includes(target.cellId), bound: systems?.boundChunkIds.includes(target.chunkId) ?? false,
      lightingGap: systems?.lighting ? systems.lighting.gap : "systems-absent", visibilityGap: systems?.visibility ? systems.visibility.gap : "systems-absent",
      lightmapped: systems?.lighting?.lightmappedChunkIds.includes(target.chunkId) ?? false,
      culled: systems?.visibility?.targetChunkIds.includes(target.chunkId) ?? false };
  }, { timeout: hopTimeout, intervals: [500] }).toEqual({ resident: true, bound: true, lightingGap: null, visibilityGap: null, lightmapped: true, culled: true });
  const end = await streamedSnapshot(page), systems = targetSystems(end, target)!;
  expect(systems.visibility!.unmappedChunks.map(chunk => chunk.chunkId)).not.toContain(target.chunkId);
  expect(end.visibilityGap).toBeNull();
  const residencyRows = end.limitRules.filter(row => row.status === "presentation");
  expect(residencyRows.map(row => row.id)).toEqual(["residency-visual-ring-radius", "residency-null-lod-cull-distance"]);
  expect(residencyRows.map(row => row.runtimeDefault)).toEqual([end.residency!.settings.visualRadiusMetres, end.residency!.settings.lodCullDistanceMetres]);
  expect(end.limitRules.find(row => row.id === "static-mesh-range")?.runtimeDefault).toBe(Infinity);
  writeFileSync(`test-results/${evidenceName}.json`, JSON.stringify({ startTileId, target, skippedTiles, hops, targetSystems: systems,
    selectedTileLightmappedChunkIds: [...new Set(end.lightingSections.filter(section => section.lighting === "lightmapped").map(section => section.chunkId))],
    limitRules: end.limitRules, residency: end.residency }, null, 2));
  await page.screenshot({ path: `test-results/${evidenceName}.png` });
  expect(pageErrors).toEqual([]);
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("lights, culls and binds a tile chunk that becomes resident after startup at 1440 x 900", async ({ page }) => {
    test.setTimeout(startTileIds.length * tileLoadTimeout + maximumHops * hopTimeout);
    await checkChunkStreamedAfterStartup(page, "world-tile-streamed-systems-desktop");
  });
});

test.describe("phone", () => {
  test.use(landscapePhone);
  test("lights, culls and binds a tile chunk that becomes resident after startup at 932 x 430 landscape with no portrait horizontal scroll", async ({ page }) => {
    test.setTimeout(startTileIds.length * tileLoadTimeout + maximumHops * hopTimeout);
    await checkChunkStreamedAfterStartup(page, "world-tile-streamed-systems-phone-landscape");
    await expectNoHorizontalScrollOnPortraitPhone(page);
  });
});
