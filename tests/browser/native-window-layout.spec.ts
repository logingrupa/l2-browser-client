import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";

const windowLaneName = "data-ui";
const laneStoreRoot = resolve("artifacts/lane-store", windowLaneName, "l2");
const laneCatalogPath = resolve(laneStoreRoot, "catalog.json");
const renderedTypesRecipePath = resolve("recipes/data/native-window-control-types.json");
const evidenceDirectory = resolve("artifacts/ui-evidence");
const unsupportedControlWindowId = "AbnormalStatusWnd";
const worldReadyTimeout = 240_000;
const nativeResourcePrefix = "/l2/";

interface DecodedWindowNode {
  readonly name: string;
  readonly type: string;
  readonly width?: number;
  readonly height?: number;
  readonly sizeMode: string;
  readonly children: readonly DecodedWindowNode[];
}

interface DecodedWindow { readonly windowId: string; readonly root: DecodedWindowNode }

interface LaneWindowRecord { readonly id: string; readonly manifest: string }

function laneWindowRecord(windowId: string): LaneWindowRecord | null {
  if (!existsSync(laneCatalogPath)) return null;
  const catalog = JSON.parse(readFileSync(laneCatalogPath, "utf8")) as { readonly windows?: readonly LaneWindowRecord[] };
  return catalog.windows?.find(record => record.id === windowId) ?? null;
}

function decodedWindow(windowId: string): DecodedWindow {
  const record = laneWindowRecord(windowId);
  if (record === null || !record.manifest.startsWith(nativeResourcePrefix)) throw new Error(`window:${windowId} has no lane-store manifest record.`);
  return JSON.parse(readFileSync(resolve(laneStoreRoot, record.manifest.slice(nativeResourcePrefix.length)), "utf8")) as DecodedWindow;
}

function decodedRootSize(windowManifest: DecodedWindow): { readonly width: number; readonly height: number } {
  const { root } = windowManifest;
  if (root.sizeMode !== "absolute" || root.width === undefined || root.height === undefined) {
    throw new Error(`window:${windowManifest.windowId} root has no absolute decoded size.`);
  }
  return { width: root.width, height: root.height };
}

function unsupportedControls(windowManifest: DecodedWindow): readonly DecodedWindowNode[] {
  const renderedTypes = (JSON.parse(readFileSync(renderedTypesRecipePath, "utf8")) as { readonly renderedTypes: readonly string[] }).renderedTypes;
  const controls: DecodedWindowNode[] = [];
  const visit = (node: DecodedWindowNode) => {
    if (!renderedTypes.includes(node.type)) controls.push(node);
    node.children.forEach(visit);
  };
  visit(windowManifest.root);
  return controls;
}

function collectPageErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  return pageErrors;
}

async function openSandboxSection(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-sandbox").click();
}

function windowRootLocator(page: Page, windowId: string) {
  return page.locator(`[data-native-window=${JSON.stringify(windowId)}]`);
}

async function openWindowFromPicker(page: Page, windowId: string): Promise<void> {
  await page.getByTestId("sandbox-window-keys").locator("select").selectOption(`window:${windowId}`);
  await page.getByTestId("sandbox-window-keys-pick").click();
  await expect(page.getByTestId("sandbox-window-note")).toHaveText(new RegExp(`^window:${windowId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} opened`));
  await expect(windowRootLocator(page, windowId)).toHaveCount(1);
}

async function expectDecodedRootSize(page: Page, windowId: string): Promise<void> {
  const size = decodedRootSize(decodedWindow(windowId));
  const box = await windowRootLocator(page, windowId).evaluate(element => {
    if (!(element instanceof HTMLElement)) throw new Error("The native window root is not an HTML element.");
    return { width: element.offsetWidth, height: element.offsetHeight };
  });
  expect(box).toEqual(size);
}

async function expectUnsupportedControlGaps(page: Page, windowId: string): Promise<void> {
  const controls = unsupportedControls(decodedWindow(windowId));
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const gapTokens = await windowRootLocator(page, windowId)
      .locator(`[data-native-control=${JSON.stringify(control.name)}][data-native-type=${JSON.stringify(control.type)}]`)
      .evaluateAll(elements => elements.map(element => (element.getAttribute("data-native-gap") ?? "").split(" ")));
    expect(gapTokens.length).toBeGreaterThan(0);
    for (const tokens of gapTokens) expect(tokens).toContain(`control-type-unsupported:${control.type}`);
  }
}

test.describe("native window layout from the sandbox window picker", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== windowLaneName, "run with NATIVE_STORE_ROOT=data-ui");
  test.skip(laneWindowRecord(unsupportedControlWindowId) === null, `window:${unsupportedControlWindowId} is not in the data-ui lane catalog`);

  test.describe("desktop", () => {
    test.use({ viewport: desktopViewport });

    test("opens a window with an unsupported control type at its decoded root size with that control marked as a gap", async ({ page }) => {
      test.setTimeout(worldReadyTimeout + 120_000);
      const pageErrors = collectPageErrors(page);
      await openSandboxSection(page);
      await openWindowFromPicker(page, unsupportedControlWindowId);
      await expectDecodedRootSize(page, unsupportedControlWindowId);
      await expectUnsupportedControlGaps(page, unsupportedControlWindowId);
      mkdirSync(evidenceDirectory, { recursive: true });
      await page.screenshot({ path: resolve(evidenceDirectory, "native-windows-1440x900.png") });
      expect(pageErrors).toEqual([]);
    });
  });
});
