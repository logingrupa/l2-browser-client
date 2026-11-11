import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { stagedNativeTerrainPath } from "./stagedNativeTerrainPath";

const staged = existsSync(resolve("public/l2/catalog.json"));

test("a failed hash-addressed section resource reports a retryable error instead of waiting forever", async ({ page }) => {
  test.skip(!staged, "Requires the staged native asset store.");
  test.setTimeout(120_000);
  const failedPath = stagedNativeTerrainPath();
  let failures = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route(url => url.pathname === failedPath, async route => {
    failures++;
    await route.fulfill({ status: 502, contentType: "text/plain", body: "Intentional startup section failure" });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Native resource returned HTTP 502", { timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Reload and retry" })).toBeVisible();
  expect(failures).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__nativeSlice === undefined)).toBe(true);
  await expect(page.getByTestId("entity-count")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("a missing native catalog reports that the native asset store is not staged", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route(url => url.pathname === "/l2/catalog.json", route => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
  await page.goto("/");
  await expect(page.locator("#loading-error")).toContainText("Native asset store not staged", { timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Reload and retry" })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeSlice === undefined)).toBe(true);
  expect(pageErrors).toEqual([]);
});
