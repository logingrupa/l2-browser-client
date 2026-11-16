import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nativeEnvironmentSource } from "../../src/scene/world/nativeEnvironmentTables";
import { readDayNightFixtureRows } from "../support/dayNightFixtures";
import { collectBrowserErrors } from "./browserErrors";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { captureStoreName, captureStoreRequirement, captureTileId, captureTileRecord, captureTileRequirement, openCaptureTile } from "./captureTileRoute";

interface SkyColourEntry { readonly setupKey: string; readonly objectName: string; readonly section: string }
interface ResolvedColourEntry extends SkyColourEntry { readonly colour: { readonly status: string; readonly value?: readonly number[]; readonly reason?: string } }
interface WrittenColourEntry extends SkyColourEntry {
  readonly materialNode: string | null;
  readonly writtenRgb: readonly number[] | null;
  readonly materialColourSource: string;
  readonly reason: string | null;
}
interface TimeOfDayReading {
  readonly status: string;
  readonly reason?: string;
  readonly snapshot?: { readonly clock: { readonly hour: number; readonly hourSource: string }; readonly oldType: number; readonly targetType: number };
  readonly environmentTypes?: readonly number[];
  readonly skyEnvironmentColours?: readonly ResolvedColourEntry[];
}

const serverGameMinutes = [0, 360, 720, 1080];
const minutesPerHour = 60;
const transitionGameMinutes = 720;
const timeTablesProduct = "time-tables.json";
const environmentDirectory = `l2/environments/${nativeEnvironmentSource.conversionManifestSha256}/conversion-manifest.json`;
const conversionManifestPath = [resolve("artifacts/lane-store", captureStoreName, environmentDirectory), resolve("public", environmentDirectory)].find(path => existsSync(path)) ?? null;
const conversionProducts = conversionManifestPath === null ? {} : (JSON.parse(readFileSync(conversionManifestPath, "utf8")) as { products?: Record<string, unknown> }).products ?? {};
const timeTablesStaged = Object.hasOwn(conversionProducts, timeTablesProduct);
const timeTablesRequirement = `environment-time-tables-unstaged: the staged environment export ${nativeEnvironmentSource.conversionManifestSha256.slice(0, 8)} has no ${timeTablesProduct}; the integration thread restages it and re-pins nativeEnvironmentSource`;

test.skip(process.env.NATIVE_STORE_ROOT !== captureStoreName, captureStoreRequirement);
test.skip(captureTileRecord === null, captureTileRequirement);
test.skip(!timeTablesStaged, timeTablesRequirement);

function fixtureColour(consumer: string, hour: number): readonly number[] {
  const row = readDayNightFixtureRows().find(candidate => candidate.consumer === consumer && candidate.hour === hour && candidate.environmentType === 0);
  if (row === undefined || !Array.isArray(row.value)) throw new Error(`No type 0 ${consumer} fixture at hour ${hour}.`);
  return row.value;
}

async function sendServerTimeAndReadTimeOfDay(page: Page, gameMinutes: number): Promise<TimeOfDayReading> {
  return page.evaluate(minutes => {
    const slice = window.__nativeSlice!;
    slice.dispatch({ type: "set-server-time", gameMinutes: minutes });
    return slice.snapshot().environment!.timeOfDay as unknown;
  }, gameMinutes) as Promise<TimeOfDayReading>;
}

async function readAfterNextFrames(page: Page): Promise<{ timeOfDay: TimeOfDayReading; written: readonly WrittenColourEntry[]; surfaces: readonly { status: string }[] }> {
  return page.evaluate(async () => {
    for (let frame = 0; frame < 2; frame += 1) await new Promise(resolveFrame => requestAnimationFrame(resolveFrame));
    const snapshot = window.__nativeSlice!.snapshot();
    const sky = snapshot.nativeSky as { environmentColours?: unknown; librarySurfaces?: unknown } | null;
    return { timeOfDay: snapshot.environment!.timeOfDay as unknown, written: sky?.environmentColours ?? [], surfaces: sky?.librarySurfaces ?? [] };
  }) as Promise<{ timeOfDay: TimeOfDayReading; written: readonly WrittenColourEntry[]; surfaces: readonly { status: string }[] }>;
}

async function openTimeOfDayGroup(page: Page, press: "click" | "tap"): Promise<void> {
  await page.getByTestId("dev-sheet-toggle")[press]();
  await page.getByTestId("dev-tab-world")[press]();
  const status = page.getByTestId("time-of-day-status");
  await expect(status).toBeVisible();
  await expect(status).toContainText("DB-4 time of day");
  await page.locator('[data-group="time-of-day"]').scrollIntoViewIfNeeded();
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("writes the DB-4 type 0 sky, haze and cloud colours into the bound sky ColorModifiers at server hours 0, 6, 12 and 18 at 1440 x 900", async ({ page }) => {
    test.setTimeout(360_000);
    const errors = collectBrowserErrors(page);
    await openCaptureTile(page);
    for (const gameMinutes of serverGameMinutes) {
      const hour = gameMinutes / minutesPerHour;
      const atDispatch = await sendServerTimeAndReadTimeOfDay(page, gameMinutes);
      if (atDispatch.status !== "running") throw new Error(`Tile ${captureTileId} has no world time of day: ${atDispatch.reason}.`);
      expect(atDispatch.snapshot).toMatchObject({ clock: { hour, hourSource: "server-time" }, oldType: 0, targetType: 0 });
      for (const entry of atDispatch.skyEnvironmentColours!) {
        expect(entry.colour, `${entry.objectName} at hour ${hour}`).toEqual({ status: "resolved", value: fixtureColour(entry.section, hour) });
      }
      const afterFrames = await readAfterNextFrames(page);
      expect(afterFrames.surfaces.some(surface => surface.status === "library-compiled"), `tile ${captureTileId} sky lists compiled programs`).toBe(true);
      const bound = afterFrames.written.filter(entry => entry.materialNode !== null);
      expect(bound.length, `tile ${captureTileId} binds at least one Env.int sky object`).toBeGreaterThan(0);
      for (const entry of bound) {
        const model = afterFrames.timeOfDay.skyEnvironmentColours!.find(candidate => candidate.setupKey === entry.setupKey)!;
        expect({ written: entry.writtenRgb, reason: entry.reason }, `${entry.objectName} material parameter`).toEqual({ written: model.colour.value, reason: null });
      }
    }
    await openTimeOfDayGroup(page, "click");
    await page.screenshot({ path: "test-results/world-day-night-sky-desktop.png" });
    expect(errors).toEqual([]);
  });
});

test.describe("desktop transition", () => {
  test.use({ viewport: desktopViewport });
  test("holds the last written sky colours during an SSQ transition instead of showing the authored ColorModifier colour", async ({ page }) => {
    test.setTimeout(360_000);
    const errors = collectBrowserErrors(page);
    await openCaptureTile(page);
    const settled = await sendServerTimeAndReadTimeOfDay(page, transitionGameMinutes);
    if (settled.status !== "running") throw new Error(`Tile ${captureTileId} has no world time of day: ${settled.reason}.`);
    const beforeTransition = await readAfterNextFrames(page);
    const writtenBefore = beforeTransition.written.filter(entry => entry.materialNode !== null);
    expect(writtenBefore.length, `tile ${captureTileId} binds at least one Env.int sky object`).toBeGreaterThan(0);
    for (const entry of writtenBefore) expect(entry.materialColourSource, `${entry.objectName} before the transition`).toBe("environment-write");
    const transitionType = settled.environmentTypes!.find(environmentType => environmentType !== 0);
    if (transitionType === undefined) throw new Error("The staged time tables load no environment type besides 0.");
    await page.evaluate(first => { window.__nativeSlice!.dispatch({ type: "set-environment-ssq-info", first, second: 0 }); }, transitionType);
    const duringTransition = await readAfterNextFrames(page);
    expect(duringTransition.timeOfDay.snapshot).toMatchObject({ oldType: 0, targetType: transitionType });
    for (const before of writtenBefore) {
      const during = duringTransition.written.find(entry => entry.setupKey === before.setupKey)!;
      expect({ writtenRgb: during.writtenRgb, source: during.materialColourSource, reason: during.reason }, `${before.objectName} during the transition`)
        .toEqual({ writtenRgb: before.writtenRgb, source: "held-environment-write", reason: "env-color-transition-unresolved" });
    }
    expect(errors).toEqual([]);
  });
});

test.describe("phone", () => {
  test.use(landscapePhone);
  test("sends server time from the Time of day group at 932 x 430 landscape with touch and has no horizontal scroll in portrait", async ({ page, hasTouch, isMobile }) => {
    test.setTimeout(360_000);
    expect({ hasTouch, isMobile }).toEqual({ hasTouch: true, isMobile: true });
    const errors = collectBrowserErrors(page);
    await openCaptureTile(page);
    await openTimeOfDayGroup(page, "tap");
    await page.getByTestId("time-of-day-server-time-gameClock").fill("18:00");
    await page.getByTestId("time-of-day-server-time-submit").tap();
    await expect.poll(async () => (await readAfterNextFrames(page)).timeOfDay.snapshot?.clock.hourSource).toBe("server-time");
    await expect(page.getByTestId("time-of-day-clock")).toContainText("18:0");
    await page.screenshot({ path: "test-results/world-day-night-sky-phone.png" });
    await expectNoHorizontalScrollOnPortraitPhone(page);
    expect(errors).toEqual([]);
  });
});
