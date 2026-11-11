import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const windowLaneName = "data-ui";
const laneCatalogPath = resolve("artifacts/lane-store", windowLaneName, "l2/catalog.json");
const censusPath = resolve("docs/parts/minimap/minimap-join-census.json");
const noConvertedTileReason = "no converted tile at the player position";
const unsupportedMinimapReason = "control-type-unsupported:MinimapCtrl";

interface CensusMinimapControl { readonly windowId: string; readonly controlNames: readonly string[] }

function firstCensusMinimapWindow(): CensusMinimapControl | null {
  const census = JSON.parse(readFileSync(censusPath, "utf8")) as { readonly minimapControls: readonly CensusMinimapControl[] };
  return census.minimapControls[0] ?? null;
}

function laneHoldsWindow(windowId: string): boolean {
  if (!existsSync(laneCatalogPath)) return false;
  const catalog = JSON.parse(readFileSync(laneCatalogPath, "utf8")) as { readonly windows?: readonly { readonly id: string }[] };
  return catalog.windows?.some(record => record.id === windowId) ?? false;
}

const minimapWindow = firstCensusMinimapWindow();

async function openMinimapWindow(page: Page, query: string): Promise<void> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/tests/browser/harness/native-window.html?window=${encodeURIComponent(minimapWindow!.windowId)}${query}`);
  await expect(page.locator("#native-window-harness")).toHaveAttribute("data-status", /^(opened|not-in-catalog|failed)$/, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__nativeWindowHarness?.result.reason ?? null)).toBeNull();
  expect(pageErrors).toEqual([]);
}

function minimapControlLocator(page: Page) {
  return page.locator(`[data-native-window=${JSON.stringify(minimapWindow!.windowId)}] [data-native-control=${JSON.stringify(minimapWindow!.controlNames[0])}]`);
}

test.describe("MinimapCtrl from the decoded interface", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== windowLaneName, "run with NATIVE_STORE_ROOT=data-ui");
  test.skip(minimapWindow === null, "the minimap census lists no window with a MinimapCtrl control");
  test.skip(minimapWindow !== null && !laneHoldsWindow(minimapWindow.windowId), "the census MinimapCtrl window is not converted in the data-ui lane store");

  test("renders the control and shows the sourced gap when the served catalog holds no tile minimap", async ({ page }) => {
    await openMinimapWindow(page, "");
    const control = minimapControlLocator(page);
    await expect(control).toHaveAttribute("data-native-type", "MinimapCtrl");
    await expect(control).not.toHaveAttribute("data-native-gap", new RegExp(unsupportedMinimapReason));
    await expect(control).toHaveAttribute("data-native-minimap-state", "ready");
    await expect(control.locator(`[data-native-gap=${JSON.stringify(noConvertedTileReason)}]`)).toHaveCount(1);
    await expect(control.locator('[data-native-minimap-part="marker"]')).toHaveCount(0);
    const gaps = await page.evaluate(() => window.__nativeWindowHarness!.result.gaps.map(gap => gap.reason));
    expect(gaps).not.toContain(unsupportedMinimapReason);
  });
});
