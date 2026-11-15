import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";

interface TileCatalogRecord { readonly id: string }
interface PlanarPoint { readonly x: number; readonly z: number }
interface BorderHop {
  readonly from: PlanarPoint;
  readonly to: PlanarPoint;
  readonly offsetMetres: number;
  readonly focusCellIds: readonly string[];
  readonly playerHeight: number;
  readonly surfaceHeight: number | null;
}
interface MovementRuleRow { readonly id: string; readonly value: number }

const laneName = "world";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? JSON.parse(readFileSync(laneCatalogPath, "utf8")) : null;
const tileGridPosition = (tileId: string) => tileId.split("_").map(Number) as [number, number];
const sharesTileBorder = (first: string, second: string) => {
  const [firstColumn, firstRow] = tileGridPosition(first), [secondColumn, secondRow] = tileGridPosition(second);
  return Math.abs(firstColumn - secondColumn) + Math.abs(firstRow - secondRow) === 1;
};
const sortedTileIds = (laneCatalog?.tiles ?? []).map(record => record.id).sort();
const borderPair = sortedTileIds.flatMap((first, index) => sortedTileIds.slice(index + 1).filter(second => sharesTileBorder(first, second)).map(second => [first, second] as const))[0] ?? null;
const tileLoadTimeout = 240_000;
const hopTimeout = 60_000;
const hopMetres = 8;
const perpendicularOffsetsMetres = [0, 8, -8, 16, -16];
const minimumHopProgressMetres = 1;
const maximumHops = 60;
const hopsPastBorder = 2;
const movementRuleRows: readonly MovementRuleRow[] = JSON.parse(readFileSync(resolve("recipes/world/movement-native-rules.json"), "utf8")).rows;
const movementRule = (id: string) => movementRuleRows.find(row => row.id === id)!.value;
const sourceUnitsPerMetre = 100;
const groundedBandMetres = (movementRule("movement.maxStepHeight") + movementRule("movement.floorBand.maximum")) / sourceUnitsPerMetre;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(borderPair === null, "no adjacent converted tile pair");
test.use({ viewport: desktopViewport });

const borderSnapshot = (page: Page) => page.evaluate(() => {
  const value = window.__nativeSlice!.snapshot();
  const player = value.entities.find(entity => entity.id === "local-player")!;
  const pawn = value.movement?.presenter.pawns.find(entry => entry.entityId === "local-player") ?? null;
  return { position: player.position, collisionCells: value.collisionCells!, residency: value.world?.residency ?? null, pawn };
});

const surfaceHeightNearest = async (page: Page, point: PlanarPoint, currentHeight: number) => {
  const heights = await page.evaluate(({ x, z }) => window.__nativeSlice!.collisionSurfaceHeightsAt!(x, z), point);
  return heights.length === 0 ? null : heights.reduce((nearest, height) => Math.abs(height - currentHeight) < Math.abs(nearest - currentHeight) ? height : nearest);
};

async function settleHop(page: Page) {
  await expect.poll(async () => (await borderSnapshot(page)).pawn?.isMoving ?? true, { timeout: hopTimeout, intervals: [250] }).toBe(false);
  return borderSnapshot(page);
}

async function expectBoundedResidencyWithNearbyCollision(page: Page) {
  const { position, collisionCells, residency, pawn } = await borderSnapshot(page);
  expect([position.x, position.y, position.z].every(Number.isFinite)).toBe(true);
  if (pawn !== null) expect(pawn.mode).toBe("walking");
  if (residency === null) throw new Error("the tile route reported no residency inspection");
  expect(residency.focusCellIds.filter(cellId => collisionCells.missingCellIds.includes(cellId))).toEqual([]);
  expect(residency.loadedChunkCount + residency.loadingChunkCount).toBeLessThanOrEqual(residency.retainedChunkCount);
  return residency;
}

async function walkOneHop(page: Page, direction: PlanarPoint): Promise<BorderHop> {
  const start = await borderSnapshot(page);
  const from = { x: start.position.x, z: start.position.z };
  const attempts: string[] = [];
  for (const offsetMetres of perpendicularOffsetsMetres) {
    const to = { x: from.x + direction.x * hopMetres - direction.z * offsetMetres, z: from.z + direction.z * hopMetres + direction.x * offsetMetres };
    const height = await surfaceHeightNearest(page, to, start.position.y);
    if (height === null) { attempts.push(`${offsetMetres} m: no collision surface`); continue; }
    await page.evaluate(position => window.__nativeSlice!.dispatch({ type: "move-local", position }), { x: to.x, y: height, z: to.z });
    const end = await settleHop(page);
    const progress = (end.position.x - from.x) * direction.x + (end.position.z - from.z) * direction.z;
    if (progress >= minimumHopProgressMetres) {
      return { from, to, offsetMetres, focusCellIds: end.residency?.focusCellIds ?? [], playerHeight: end.position.y,
        surfaceHeight: await surfaceHeightNearest(page, { x: end.position.x, z: end.position.z }, end.position.y) };
    }
    attempts.push(`${offsetMetres} m: ${progress.toFixed(2)} m progress, held ${end.pawn?.heldReason ?? "no pawn"}`);
  }
  throw new Error(`blocked hop from ${from.x.toFixed(2)}, ${from.z.toFixed(2)} toward ${direction.x}, ${direction.z}: no line crosses (${attempts.join("; ")})`);
}

test("walks the player across the border between two adjacent converted tiles with bounded cells and nearby collision kept", async ({ page }) => {
  const [startTileId, targetTileId] = borderPair!;
  test.setTimeout(tileLoadTimeout + maximumHops * hopTimeout);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/?map=${startTileId}`);
  await page.waitForFunction(() => document.body.dataset.worldState === "ready" && window.__nativeSlice !== undefined, null, { timeout: tileLoadTimeout });
  await expect.poll(async () => (await borderSnapshot(page)).collisionCells.status, { timeout: tileLoadTimeout, intervals: [1_000] }).toBe("resident");
  const startResidency = await expectBoundedResidencyWithNearbyCollision(page);
  const startPosition = (await borderSnapshot(page)).position;
  const startSurfaceHeight = await surfaceHeightNearest(page, { x: startPosition.x, z: startPosition.z }, startPosition.y);
  if (startSurfaceHeight === null) throw new Error("no collision surface under the player at the tile anchor");
  const feetAboveSurface = startPosition.y - startSurfaceHeight;
  expect(startResidency.failedChunks).toEqual([]);
  expect((await borderSnapshot(page)).collisionCells.residentCellCount).toBeGreaterThan(0);
  const startLoadedCellIds = startResidency.loadedCellIds.filter(cellId => cellId.startsWith(`${startTileId}/`));
  const [startColumn, startRow] = tileGridPosition(startTileId), [targetColumn, targetRow] = tileGridPosition(targetTileId);
  const direction = { x: targetColumn - startColumn, z: targetRow - startRow };
  const hops: BorderHop[] = [];
  let hopsInsideTarget = 0;
  while (hopsInsideTarget < hopsPastBorder) {
    if (hops.length >= maximumHops) throw new Error(`the walk did not reach ${targetTileId} within ${maximumHops} hops`);
    const hop = await walkOneHop(page, direction);
    hops.push(hop);
    await expectBoundedResidencyWithNearbyCollision(page);
    expect.soft(hop.surfaceHeight === null ? Number.POSITIVE_INFINITY : Math.abs(hop.playerHeight - hop.surfaceHeight - feetAboveSurface),
      `hop ${hops.length} ends on the walked collision surface, not below it`).toBeLessThanOrEqual(groundedBandMetres);
    if (hop.focusCellIds.some(cellId => cellId.startsWith(`${targetTileId}/`))) hopsInsideTarget += 1;
  }
  const end = await expectBoundedResidencyWithNearbyCollision(page);
  const startChunksBeyondRetain = startLoadedCellIds.filter(cellId => !end.retainedCellIds.includes(cellId));
  writeFileSync(`test-results/world-tile-border-${startTileId}-${targetTileId}.json`, JSON.stringify({ startTileId, targetTileId, hops, startLoadedCellIds,
    startChunksBeyondRetain, residency: end }, null, 2));
  expect(startChunksBeyondRetain.length).toBeGreaterThan(0);
  expect(end.disposedChunkCount).toBeGreaterThan(0);
  expect(startChunksBeyondRetain.filter(cellId => end.loadedCellIds.includes(cellId))).toEqual([]);
  await page.screenshot({ path: `test-results/world-tile-border-${startTileId}-${targetTileId}-desktop.png` });
  expect(pageErrors).toEqual([]);
});
