import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";

const staged = existsSync(resolve("public/l2/catalog.json"));
const worldReadyTimeout = 240_000;

test.use({ viewport: desktopViewport });

test("the developer sheet Power Strike no-target viewer plays the impact on the fighter with the PawnViewer self-target placement", async ({ page }) => {
  test.skip(!staged, "The native store must be staged at public/l2/catalog.json.");
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-combat").click();
  const viewerButton = page.getByTestId("native-power-strike-viewer-play");
  await expect(viewerButton).toHaveText("Power Strike no-target viewer (dev)");
  await viewerButton.click();
  await expect.poll(async () => page.evaluate(() => window.__nativeSlice!.snapshot().powerStrike?.shot?.shots ?? 0), { timeout: 60_000 }).toBe(1);
  const powerStrike = await page.evaluate(() => window.__nativeSlice!.snapshot().powerStrike!);
  expect(powerStrike.action).toMatchObject({ noTargetViewer: true, targetId: null, requested: 1, damageDispatched: false });
  expect(powerStrike.shot).toMatchObject({ noTargetViewer: true, targetId: null });
  const placement = powerStrike.shot!.placement!;
  expect(placement.policy).toBe("pawnviewer-self-target-v1");
  expect(placement.quaternion).toEqual([0, 0, 0, 1]);
  expect(placement.position[0]).toBeCloseTo(placement.caster[0] - placement.halfRadius, 9);
  expect(pageErrors).toEqual([]);
});
