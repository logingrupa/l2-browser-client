import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { nativeSandboxStaged, nativeSandboxStagingRequirement, openNativeSandbox } from "./nativeSandboxRoute";
import { desktopViewport, landscapePhone } from "./browserViewports";
import { collectBrowserErrors } from "./browserErrors";

interface CanvasPoint { x: number; y: number }

const minimumPinchRadiusChangeFraction = 0.1;

async function readOrbitCamera(page: Page) {
  return page.evaluate(() => {
    const camera = window.__nativeSlice?.snapshot().camera;
    if (!camera) throw new Error("The native world camera is unavailable.");
    return camera;
  });
}

function requireCameraLimit(limit: number | null, name: string): number {
  if (limit === null) throw new Error(`The native world camera has no ${name}.`);
  return limit;
}

async function readOrbitLimits(page: Page) {
  const camera = await readOrbitCamera(page);
  return {
    lowerRadius: requireCameraLimit(camera.lowerRadiusLimit, "lowerRadiusLimit"),
    upperRadius: requireCameraLimit(camera.upperRadiusLimit, "upperRadiusLimit"),
    lowerBeta: requireCameraLimit(camera.lowerBetaLimit, "lowerBetaLimit"),
    upperBeta: requireCameraLimit(camera.upperBetaLimit, "upperBetaLimit"),
  };
}

async function findOpenCanvasPoint(page: Page, horizontalReach: number): Promise<CanvasPoint> {
  return page.evaluate(reach => {
    const canvas = document.querySelector("#canvas");
    if (!canvas) throw new Error("The world canvas is missing.");
    for (const heightFraction of [0.5, 0.45, 0.55, 0.4, 0.6]) {
      for (const widthFraction of [0.25, 0.75, 0.35, 0.65, 0.5]) {
        const x = window.innerWidth * widthFraction, y = window.innerHeight * heightFraction;
        if (document.elementFromPoint(x - reach, y) === canvas && document.elementFromPoint(x + reach, y) === canvas) return { x, y };
      }
    }
    throw new Error("No unobstructed canvas area is available for the camera gesture.");
  }, horizontalReach);
}

async function moveMouseToOpenCanvas(page: Page): Promise<CanvasPoint> {
  const point = await findOpenCanvasPoint(page, 0);
  await page.mouse.move(point.x, point.y);
  return point;
}

async function rightDrag(page: Page, horizontalPixels: number, verticalPixels: number, steps: number): Promise<void> {
  const start = await moveMouseToOpenCanvas(page);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(start.x + horizontalPixels, start.y + verticalPixels, { steps });
  await page.mouse.up({ button: "right" });
}

async function enableMultiTouch(page: Page): Promise<CDPSession> {
  const touchSession = await page.context().newCDPSession(page);
  await touchSession.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  return touchSession;
}

test.describe("desktop orbit camera", () => {
  test.use({ viewport: desktopViewport });

  test("right drag orbits, the wheel stops at the camera's own radius limits and vertical orbit stops at its beta limits", async ({ page }) => {
    test.skip(!nativeSandboxStaged, nativeSandboxStagingRequirement);
    test.setTimeout(240_000);
    const errors = collectBrowserErrors(page);
    await openNativeSandbox(page);
    const limits = await readOrbitLimits(page);

    const beforeOrbit = await readOrbitCamera(page);
    await rightDrag(page, 160, 65, 12);
    await expect.poll(async () => Math.abs((await readOrbitCamera(page)).alpha - beforeOrbit.alpha)).toBeGreaterThan(0.05);

    await moveMouseToOpenCanvas(page);
    await page.mouse.wheel(0, -20_000);
    await expect.poll(async () => (await readOrbitCamera(page)).radius).toBe(limits.lowerRadius);
    await expect.poll(async () => {
      await moveMouseToOpenCanvas(page);
      await page.mouse.wheel(0, 20_000);
      return (await readOrbitCamera(page)).radius;
    }, { timeout: 60_000 }).toBe(limits.upperRadius);

    await rightDrag(page, 0, -1200, 10);
    await expect.poll(async () => {
      const { beta } = await readOrbitCamera(page);
      return Math.min(Math.abs(beta - limits.lowerBeta), Math.abs(beta - limits.upperBeta));
    }).toBe(0);
    const finalCamera = await readOrbitCamera(page);
    expect(finalCamera.beta).toBeGreaterThanOrEqual(limits.lowerBeta);
    expect(finalCamera.beta).toBeLessThanOrEqual(limits.upperBeta);
    expect(finalCamera.radius).toBeGreaterThanOrEqual(limits.lowerRadius);
    expect(finalCamera.radius).toBeLessThanOrEqual(limits.upperRadius);
    expect(errors).toEqual([]);
  });
});

test.describe("landscape phone orbit camera", () => {
  test.use(landscapePhone);

  test("one finger orbits and a two finger pinch zooms within the camera's own radius limits", async ({ page }) => {
    test.skip(!nativeSandboxStaged, nativeSandboxStagingRequirement);
    test.setTimeout(240_000);
    const errors = collectBrowserErrors(page);
    const touchSession = await enableMultiTouch(page);
    try {
      await openNativeSandbox(page);
      expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThanOrEqual(2);
      const limits = await readOrbitLimits(page);

      const orbitStart = await findOpenCanvasPoint(page, 0);
      const beforeOrbit = await readOrbitCamera(page);
      await touchSession.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [orbitStart] });
      for (let move = 1; move <= 8; move += 1) {
        await touchSession.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: orbitStart.x + move * 10, y: orbitStart.y + move * 2 }] });
      }
      await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(async () => Math.abs((await readOrbitCamera(page)).alpha - beforeOrbit.alpha)).toBeGreaterThan(0.02);

      const pinchCenter = await findOpenCanvasPoint(page, 45);
      const beforePinch = await readOrbitCamera(page);
      await touchSession.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ id: 0, x: pinchCenter.x - 45, y: pinchCenter.y }, { id: 1, x: pinchCenter.x + 45, y: pinchCenter.y }],
      });
      for (let move = 1; move <= 8; move += 1) {
        const fingerDistance = 45 + move * 6;
        await touchSession.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ id: 0, x: pinchCenter.x - fingerDistance, y: pinchCenter.y }, { id: 1, x: pinchCenter.x + fingerDistance, y: pinchCenter.y }],
        });
      }
      await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(async () => Math.abs((await readOrbitCamera(page)).radius - beforePinch.radius))
        .toBeGreaterThan(beforePinch.radius * minimumPinchRadiusChangeFraction);
      const afterPinch = await readOrbitCamera(page);
      expect(afterPinch.radius).toBeGreaterThanOrEqual(limits.lowerRadius);
      expect(afterPinch.radius).toBeLessThanOrEqual(limits.upperRadius);
      expect(errors).toEqual([]);
    } finally { await touchSession.detach(); }
  });
});
