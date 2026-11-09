import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";

const windowLaneName = "data-ui";
const windowLaneCatalogPath = resolve("artifacts/lane-store", windowLaneName, "l2/catalog.json");
const statusWindowId = "StatusWnd";
const worldReadyTimeout = 240_000;

function windowLaneHoldsStatusWindow(): boolean {
  if (!existsSync(windowLaneCatalogPath)) return false;
  const catalog = JSON.parse(readFileSync(windowLaneCatalogPath, "utf8")) as { windows?: readonly { readonly id: string }[] };
  return catalog.windows?.some(record => record.id === statusWindowId) ?? false;
}

async function openSandboxSection(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-sandbox").click();
}

async function pickWindow(page: Page, windowId: string): Promise<void> {
  await page.getByTestId("sandbox-window-keys").locator("select").selectOption(`window:${windowId}`);
  await page.getByTestId("sandbox-window-keys-pick").click();
}

test.describe("window picker on the native route", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== windowLaneName, "run with NATIVE_STORE_ROOT=data-ui");
  test.skip(!windowLaneHoldsStatusWindow(), "window:StatusWnd is not in the data-ui lane catalog");
  test.use({ viewport: desktopViewport });

  test("opens StatusWnd once in the native window layer and brings the same instance forward on a second pick", async ({ page }) => {
    test.setTimeout(worldReadyTimeout + 120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await openSandboxSection(page);
    await pickWindow(page, statusWindowId);
    await expect(page.getByTestId("sandbox-window-note")).toHaveText(/^window:StatusWnd opened/);
    await expect(page.locator(`[data-native-window="${statusWindowId}"]`)).toHaveCount(1);
    await pickWindow(page, statusWindowId);
    await expect(page.getByTestId("sandbox-window-note")).toHaveText(/^window:StatusWnd opened/);
    await expect(page.locator(`[data-native-window="${statusWindowId}"]`)).toHaveCount(1);
    expect(pageErrors).toEqual([]);
  });
});
