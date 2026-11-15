import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport, landscapePhone } from "./browserViewports";

const laneName = "data-ui";
const laneStoreRoot = resolve("artifacts/lane-store", laneName);
const laneCatalogPath = resolve(laneStoreRoot, "l2/catalog.json");
const bottomRightWindowId = "MainMenuWnd";
const bottomRightAnchor = 9;
const harnessUrl = `/tests/browser/harness/native-window.html?window=${bottomRightWindowId}`;

interface LaneWindowRecord { readonly id: string; readonly manifest: string }
interface DecodedPosition { readonly selfAnchor: number; readonly targetAnchor: number; readonly target: string; readonly offsetX: number; readonly offsetY: number }
interface DecodedRoot { readonly width: number; readonly height: number; readonly position: DecodedPosition }

function laneWindowRecord(): LaneWindowRecord | undefined {
  if (!existsSync(laneCatalogPath)) return undefined;
  const catalog = JSON.parse(readFileSync(laneCatalogPath, "utf8")) as { windows?: LaneWindowRecord[] };
  return catalog.windows?.find(record => record.id === bottomRightWindowId);
}

function decodedRoot(record: LaneWindowRecord): DecodedRoot {
  return (JSON.parse(readFileSync(resolve(laneStoreRoot, `.${record.manifest}`), "utf8")) as { root: DecodedRoot }).root;
}

const windowRecord = laneWindowRecord();

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=data-ui");
test.skip(windowRecord === undefined, `window:${bottomRightWindowId} not converted in the data-ui lane store`);

async function windowRootBox(page: Page): Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }> {
  const box = await page.locator(`[data-native-window="${bottomRightWindowId}"]`).boundingBox();
  if (box === null) throw new Error(`window:${bottomRightWindowId} has no layout box`);
  return box;
}

test("re-anchors a bottom-right window to the new viewport corner when the viewport shrinks to the landscape phone", async ({ page }) => {
  const root = decodedRoot(windowRecord!);
  expect([root.position.selfAnchor, root.position.targetAnchor, root.position.target]).toEqual([bottomRightAnchor, bottomRightAnchor, ""]);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.setViewportSize(desktopViewport);
  await page.goto(harnessUrl);
  await expect(page.locator("#native-window-harness")).toHaveAttribute("data-status", "opened", { timeout: 30_000 });
  for (const viewport of [desktopViewport, landscapePhone.viewport]) {
    await page.setViewportSize(viewport);
    const expectedLeft = viewport.width - root.width + root.position.offsetX;
    const expectedTop = viewport.height - root.height + root.position.offsetY;
    await expect.poll(async () => { const box = await windowRootBox(page); return [box.x, box.y]; }).toEqual([expectedLeft, expectedTop]);
  }
  expect(pageErrors).toEqual([]);
});
