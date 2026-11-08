import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const sceneFile = resolve("public/scene/native-world.babylon");
const staged = existsSync(sceneFile);

test("a failed authored geometry request reports a retryable error instead of waiting forever", async ({ page }) => {
  test.skip(!staged, "Requires the locally staged authored native scene.");
  test.setTimeout(120_000);
  const scene = JSON.parse(readFileSync(sceneFile, "utf8")) as { meshes: { delayLoadingFile?: string }[] };
  const resource = scene.meshes.find(mesh => mesh.delayLoadingFile)?.delayLoadingFile;
  expect(resource).toBeTruthy();
  const failedPath = new URL(resource!, "http://localhost/scene/").pathname;
  let failures = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route(url => url.pathname === failedPath, async route => {
    failures++;
    await route.fulfill({ status: 502, contentType: "text/plain", body: "Intentional startup geometry failure" });
  });
  await page.goto("/?authored=1");
  await expect(page.getByRole("alert")).toContainText("World geometry could not be loaded", { timeout: 90_000 });
  await expect(page.getByRole("alert")).toContainText("reload to try again");
  expect(failures).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__nativeSlice === undefined)).toBe(true);
  await expect(page.getByTestId("entity-count")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
