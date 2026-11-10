import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { desktopViewport, landscapePhone } from "./browserViewports";
import type { TranslucentOrderHarnessState } from "./harness/translucentOrderHarness";

type DoneState = Extract<TranslucentOrderHarnessState, { state: "done" }>;

const harnessTimeout = 120_000;
const sheetDimmingLimit = .75;

async function drawAroundWaterSheet(page: Page, screenshotPath: string): Promise<DoneState> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/tests/browser/harness/translucent-order.html");
  await expect.poll(() => page.evaluate(() => window.__translucentOrderHarness?.state ?? "missing"), { timeout: harnessTimeout }).toMatch(/^(done|failed)$/);
  const state = await page.evaluate(() => window.__translucentOrderHarness!);
  if (state.state !== "done") throw new Error(`the translucent order harness did not finish: ${JSON.stringify(state)}`);
  await page.screenshot({ path: screenshotPath });
  writeFileSync(screenshotPath.replace(/[.]png$/, ".json"), JSON.stringify(state, null, 2));
  expect(pageErrors).toEqual([]);
  return state;
}

function expectPowerStrikeSortedAgainstTheSheet(state: DoneState) {
  const [inFront, behind] = state.placements;
  expect(inFront!.sheetPlacement).toBe("in-front");
  expect(behind!.sheetPlacement).toBe("behind");
  expect(state.liveParticles).toBeGreaterThan(0);
  expect(behind!.redPixelCount).toBeGreaterThan(0);
  expect(inFront!.brightestRed).toBeLessThan(behind!.brightestRed * sheetDimmingLimit);
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("a Power Strike in front of and behind a water sheet draws in distance order at 1440 x 900", async ({ page }) => {
    test.setTimeout(harnessTimeout * 2);
    expectPowerStrikeSortedAgainstTheSheet(await drawAroundWaterSheet(page, "test-results/translucent-order-desktop.png"));
  });
});

test.describe("phone", () => {
  test.use(landscapePhone);
  test("a Power Strike in front of and behind a water sheet draws in distance order at 932 x 430 landscape", async ({ page }) => {
    test.setTimeout(harnessTimeout * 2);
    expectPowerStrikeSortedAgainstTheSheet(await drawAroundWaterSheet(page, "test-results/translucent-order-phone-landscape.png"));
  });
});
