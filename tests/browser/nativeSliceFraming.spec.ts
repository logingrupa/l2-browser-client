import { expect, test, type Page } from "@playwright/test";
import { desktopViewport } from "./browserViewports";
import { collectBrowserErrors } from "./browserErrors";
import { captureStoreName, captureStoreRequirement, captureTileId, captureTileRecord, captureTileRequirement, openCaptureTile } from "./captureTileRoute";

const alphaChangeRadians = .5;
const radiusBeyondUpperLimitMetres = 1;
const framingGameMinutes = 720;

test.skip(process.env.NATIVE_STORE_ROOT !== captureStoreName, captureStoreRequirement);
test.skip(captureTileRecord === null, captureTileRequirement);

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

  test("setCameraPose round-trips the snapshot camera read-out and refuses a radius beyond the limit; set-server-time moves the clock through the adapter", async ({ page }) => {
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
    if (!environmentBefore.clock) throw new Error(`Tile ${captureTileId} has no environment clock: ${environmentBefore.lastRejectedEvent ?? "no lighting resource"}.`);
    await page.evaluate(gameMinutes => {
      window.__nativeSlice!.dispatch({ type: "set-server-time", gameMinutes });
    }, framingGameMinutes);
    const environmentAfter = await readEnvironmentInspection(page);
    expect(environmentAfter.appliedEventCount).toBe(environmentBefore.appliedEventCount + 1);
    expect(environmentAfter.rejectedEventCount).toBe(environmentBefore.rejectedEventCount);
    expect(environmentAfter.clock).toMatchObject({ source: "server-time" });
    expect(errors).toEqual([]);
  });
});
