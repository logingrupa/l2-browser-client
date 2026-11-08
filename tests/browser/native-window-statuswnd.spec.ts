import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";

const laneName = "data-ui";
const laneStoreRoot = resolve("artifacts/lane-store", laneName);
const laneCatalogPath = resolve(laneStoreRoot, "l2/catalog.json");
const statusWindowId = "StatusWnd";
const harnessUrl = `/tests/browser/harness/native-window.html?window=${statusWindowId}`;

interface LaneWindowRecord { readonly id: string; readonly manifest: string }
interface DecodedRoot { readonly name: string; readonly width: number; readonly height: number }
interface FieldBindingRow { readonly windowId: string; readonly controlName: string; readonly worldField: string | null; readonly gapReason: string | null }

function laneStatusWindowRecord(): LaneWindowRecord | undefined {
  if (!existsSync(laneCatalogPath)) return undefined;
  const catalog = JSON.parse(readFileSync(laneCatalogPath, "utf8")) as { windows?: LaneWindowRecord[] };
  return catalog.windows?.find(record => record.id === statusWindowId);
}

function decodedStatusRoot(record: LaneWindowRecord): DecodedRoot {
  return (JSON.parse(readFileSync(resolve(laneStoreRoot, `.${record.manifest}`), "utf8")) as { root: DecodedRoot }).root;
}

function statusBindings(): readonly FieldBindingRow[] {
  const recipe = JSON.parse(readFileSync("recipes/data/window-field-bindings.json", "utf8")) as { bindings: FieldBindingRow[] };
  return recipe.bindings.filter(binding => binding.windowId === statusWindowId);
}

const statusRecord = laneStatusWindowRecord();

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=data-ui");
test.skip(statusRecord === undefined, "window:StatusWnd not converted in the data-ui lane store");

async function openStatusWindow(page: Page): Promise<void> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(harnessUrl);
  await expect(page.locator("#native-window-harness")).toHaveAttribute("data-status", /^(opened|not-in-catalog|failed)$/, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__nativeWindowHarness?.result.reason ?? null)).toBeNull();
  expect(pageErrors).toEqual([]);
  await expect(page.locator(`[data-native-window="${statusWindowId}"]`)).toBeVisible();
}

async function boxWidth(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} has no layout box`);
  return box.width;
}

test("opens StatusWnd from its decoded manifest with HP bound to the adapter local player at 1440 x 900", async ({ browser }) => {
  const root = decodedStatusRoot(statusRecord!);
  const boundGauge = statusBindings().find(binding => binding.worldField === "health")!;
  const context = await browser.newContext({ viewport: desktopViewport });
  const page = await context.newPage();
  await openStatusWindow(page);
  const rootBox = await page.locator(`[data-native-window="${statusWindowId}"]`).boundingBox();
  expect([rootBox?.width, rootBox?.height]).toEqual([root.width, root.height]);
  const gaugeSelector = `[data-native-control="${boundGauge.controlName}"]`;
  const gaugeWidth = await boxWidth(page, gaugeSelector);
  expect(await boxWidth(page, `${gaugeSelector} > [data-native-gauge-fill]`)).toBe(Math.trunc(gaugeWidth * 100 / 100));
  await context.close();
});
