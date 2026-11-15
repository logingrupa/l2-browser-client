import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";

interface TileCatalogRecord { readonly id: string; readonly manifestSha256: string }

const laneName = "world";
const tileId = "20_21";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? JSON.parse(readFileSync(laneCatalogPath, "utf8")) : null;
const tileRecord = laneCatalog?.tiles?.find(record => record.id === tileId) ?? null;
const tileLoadTimeout = 240_000;
const walkTimeout = 90_000;
const clickFractions = [[.5, .78], [.38, .8], [.62, .8], [.5, .9], [.3, .7], [.7, .7]] as const;
const minimumWalkedMetres = .5;
const arrivalReachMetres = .05;
const walkRecordPath = (screenshotPath: string) => screenshotPath.replace(/\.png$/, ".json");

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(tileRecord === null, "the world lane catalog has no tiles record 20_21");

const snapshot = (page: Page) => page.evaluate(() => {
  const value = window.__nativeSlice!.snapshot();
  return { collisionCells: value.collisionCells!, movement: value.movement!, player: value.entities.find(entity => entity.id === "local-player")! };
});

async function openTileWithResidentCollision(page: Page, pageErrors: string[]) {
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/?map=${tileId}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__nativeSlice)), { timeout: tileLoadTimeout, intervals: [1_000] }).toBe(true);
  await expect.poll(async () => (await snapshot(page)).collisionCells.status, { timeout: tileLoadTimeout, intervals: [1_000] }).not.toBe("loading");
  const { collisionCells } = await snapshot(page);
  expect(collisionCells).toMatchObject({ status: "resident", failure: null, missingCellIds: [] });
  expect(collisionCells.residentCellCount).toBe(collisionCells.requiredCellCount);
  expect(collisionCells.residentCellCount).toBeGreaterThan(0);
  const start = (await snapshot(page)).player.position;
  expect(await page.evaluate(({ x, z }) => window.__nativeSlice!.collisionSurfaceHeightsAt!(x, z), start)).toHaveLength(1);
}

async function pressReachablePoint(page: Page, press: (x: number, y: number) => Promise<void>) {
  const viewport = page.viewportSize()!;
  for (const [horizontal, vertical] of clickFractions) {
    const before = (await snapshot(page)).movement.lastLocalDestination;
    await press(viewport.width * horizontal, viewport.height * vertical);
    const after = (await snapshot(page)).movement.lastLocalDestination;
    if (after !== null && JSON.stringify(after) !== JSON.stringify(before)) return after;
  }
  throw new Error("no pointer position over the tile hit its collision surface");
}

async function walkByPointer(page: Page, screenshotPath: string, press: (x: number, y: number) => Promise<void>) {
  const pageErrors: string[] = [];
  await openTileWithResidentCollision(page, pageErrors);
  const start = (await snapshot(page)).player.position;
  const destination = await pressReachablePoint(page, press);
  await expect.poll(async () => (await snapshot(page)).movement.dispatchedIntentCounts["report-position"], { timeout: walkTimeout }).toBeGreaterThan(0);
  await expect.poll(async () => {
    const { movement } = await snapshot(page);
    return movement.presenter.pawns.find(pawn => pawn.entityId === "local-player")?.isMoving ?? true;
  }, { timeout: walkTimeout }).toBe(false);
  const end = await snapshot(page);
  writeFileSync(walkRecordPath(screenshotPath), JSON.stringify({ start, destination, end: { player: end.player.position, authoritative: end.player.authoritativePosition,
    movement: end.movement, collisionCells: { ...end.collisionCells, load: null } } }, null, 2));
  expect(Math.hypot(end.player.position.x - destination.x, end.player.position.z - destination.z)).toBeLessThan(arrivalReachMetres);
  expect(Math.hypot(end.player.authoritativePosition.x - start.x, end.player.authoritativePosition.z - start.z)).toBeGreaterThan(minimumWalkedMetres);
  expect(end.collisionCells.missingCellIds).toEqual([]);
  expect(end.movement.rejectedRecordCount).toBe(0);
  await page.screenshot({ path: screenshotPath });
  expect(pageErrors).toEqual([]);
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("a click on tile 20_21 walks the player through the MOVE-01 port at 1440 x 900", async ({ page }) => {
    test.setTimeout(tileLoadTimeout * 2 + walkTimeout);
    await walkByPointer(page, "test-results/world-movement-port-20_21-desktop.png", (x, y) => page.mouse.click(x, y));
  });
});

test.describe("phone", () => {
  test.use(landscapePhone);
  test("a tap on tile 20_21 walks the player at 932 x 430 landscape and has no horizontal scroll in portrait", async ({ page }) => {
    test.setTimeout(tileLoadTimeout * 2 + walkTimeout);
    await walkByPointer(page, "test-results/world-movement-port-20_21-phone-landscape.png", (x, y) => page.touchscreen.tap(x, y));
    await expectNoHorizontalScrollOnPortraitPhone(page);
  });
});
