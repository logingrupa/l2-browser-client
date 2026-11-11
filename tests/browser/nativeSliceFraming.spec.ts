import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";
import { collectBrowserErrors } from "./browserErrors";

interface TileCatalogRecord { readonly id: string; readonly manifestSha256: string }

const captureStoreName = "integration";
const tileId = "20_20";
const captureCatalogPath = resolve("artifacts/lane-store", captureStoreName, "l2/catalog.json");
const captureCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(captureCatalogPath) ? JSON.parse(readFileSync(captureCatalogPath, "utf8")) : null;
const tileRecord = captureCatalog?.tiles?.find(record => record.id === tileId) ?? null;
const tileLoadTimeout = 240_000;
const alphaChangeRadians = .5;
const radiusBeyondUpperLimitMetres = 1;
const framingGameMinutes = 720;

test.skip(process.env.NATIVE_STORE_ROOT !== captureStoreName, "run with NATIVE_STORE_ROOT=integration, the store sandbox halves are captured on");
test.skip(tileRecord === null, "the integration union catalog has no tiles record 20_20");

async function openCaptureTile(page: Page): Promise<void> {
  await page.goto(`/?map=${tileId}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__nativeSlice?.snapshot().world)), { timeout: tileLoadTimeout, intervals: [1_000] }).toBe(true);
  expect(await page.evaluate(() => window.__nativeSlice!.snapshot().world!.manifestSha256)).toBe(tileRecord!.manifestSha256);
}

async function readSnapshotCamera(page: Page) {
  return page.evaluate(() => {
    const camera = window.__nativeSlice?.snapshot().camera;
    if (!camera) throw new Error("The native world camera is unavailable.");
    return camera;
  });
}

async function readCameraPose(page: Page) {
  const { target, alpha, beta, radius } = await readSnapshotCamera(page);
  return { target, alpha, beta, radius };
}

async function readEnvironmentInspection(page: Page) {
  return page.evaluate(() => {
    const environment = window.__nativeSlice?.snapshot().environment;
    if (!environment) throw new Error("The native world environment inspection is unavailable.");
    return environment;
  });
}

async function setCameraPose(page: Page, pose: { target: number[]; alpha: number; beta: number; radius: number }): Promise<void> {
  await page.evaluate(requestedPose => {
    const setPose = window.__nativeSlice?.setCameraPose;
    if (!setPose) throw new Error("window.__nativeSlice.setCameraPose is unavailable.");
    setPose(requestedPose);
  }, pose);
}

test.describe("sandbox framing for side-by-side halves", () => {
  test.use({ viewport: desktopViewport });

  test("setCameraPose round-trips the snapshot camera read-out and refuses a radius beyond the limit; set-environment moves the clock through the adapter", async ({ page }) => {
    test.setTimeout(300_000);
    const errors = collectBrowserErrors(page);
    await openCaptureTile(page);

    const recorded = await readSnapshotCamera(page);
    const requestedPose = { target: recorded.target, alpha: recorded.alpha + alphaChangeRadians, beta: recorded.beta, radius: recorded.radius };
    await setCameraPose(page, requestedPose);
    await expect.poll(() => readCameraPose(page)).toEqual(requestedPose);

    if (recorded.upperRadiusLimit !== null) {
      const refusedPose = { ...requestedPose, radius: recorded.upperRadiusLimit + radiusBeyondUpperLimitMetres };
      await expect(setCameraPose(page, refusedPose)).rejects.toThrow(`is above upperRadiusLimit ${recorded.upperRadiusLimit}`);
      expect(await readCameraPose(page)).toEqual(requestedPose);
    }

    const environmentBefore = await readEnvironmentInspection(page);
    if (!environmentBefore.clock) throw new Error(`Tile ${tileId} has no environment clock: ${environmentBefore.lastRejectedEvent ?? "no lighting resource"}.`);
    const currentEnvironmentType = environmentBefore.clock.environmentType;
    await page.evaluate(([gameMinutes, environmentType]) => {
      window.__nativeSlice!.dispatch({ type: "set-environment", gameMinutes, environmentType });
    }, [framingGameMinutes, currentEnvironmentType] as const);
    const environmentAfter = await readEnvironmentInspection(page);
    expect(environmentAfter.appliedEventCount).toBe(environmentBefore.appliedEventCount + 1);
    expect(environmentAfter.rejectedEventCount).toBe(environmentBefore.rejectedEventCount);
    expect(environmentAfter.clock).toMatchObject({ source: "environment-event", environmentType: currentEnvironmentType });
    expect(errors).toEqual([]);
  });
});
