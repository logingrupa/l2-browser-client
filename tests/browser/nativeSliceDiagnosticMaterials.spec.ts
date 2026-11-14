import { expect, test, type Page } from "@playwright/test";
import { nativeSandboxStaged, nativeSandboxStagingRequirement, openNativeSandbox } from "./nativeSandboxRoute";
import { desktopViewport } from "./browserViewports";
import { collectBrowserErrors } from "./browserErrors";
import { captureStoreName, captureStoreRequirement, captureTileRecord, captureTileRequirement, openCaptureTile } from "./captureTileRoute";

const defaultRouteWorldLoadTimeout = 150_000;
const diagnosticMaterialEntryKeys = ["reasons", "root", "unportedClass"];

async function expectSortedUniqueDiagnosticMaterials(page: Page, routeName: string): Promise<void> {
  const diagnosticMaterials: unknown = await page.evaluate(() => window.__nativeSlice!.snapshot().diagnosticMaterials);
  expect(Array.isArray(diagnosticMaterials)).toBe(true);
  const entries = diagnosticMaterials as Record<string, unknown>[];
  for (const entry of entries) {
    expect(Object.keys(entry).sort()).toEqual(diagnosticMaterialEntryKeys);
    expect(typeof entry.root).toBe("string");
    expect(entry.unportedClass === null || typeof entry.unportedClass === "string").toBe(true);
    expect(Array.isArray(entry.reasons) && entry.reasons.every(reason => typeof reason === "string")).toBe(true);
  }
  const roots = entries.map(entry => entry.root as string);
  expect(roots).toEqual([...roots].sort());
  expect(new Set(roots).size).toBe(roots.length);
  console.log(`${routeName} diagnosticMaterials entries: ${entries.length}`);
}

test.describe("sandbox diagnostic materials read-out", () => {
  test.use({ viewport: desktopViewport });

  test("the default sandbox route lists each visible diagnostic root once, sorted, with exactly root, unportedClass and reasons", async ({ page }) => {
    test.skip(!nativeSandboxStaged, nativeSandboxStagingRequirement);
    test.skip(process.env.NATIVE_STORE_ROOT === captureStoreName, "the default sandbox route runs on the main-checkout store");
    test.setTimeout(300_000);
    const errors = collectBrowserErrors(page);
    await openNativeSandbox(page);
    await expect.poll(() => page.evaluate(() => Boolean(window.__nativeSlice?.snapshot().world)), { timeout: defaultRouteWorldLoadTimeout, intervals: [1_000] }).toBe(true);
    await expectSortedUniqueDiagnosticMaterials(page, "default route");
    expect(errors).toEqual([]);
  });

  test("the capture tile route lists each visible diagnostic root once, sorted, with exactly root, unportedClass and reasons", async ({ page }) => {
    test.skip(process.env.NATIVE_STORE_ROOT !== captureStoreName, captureStoreRequirement);
    test.skip(captureTileRecord === null, captureTileRequirement);
    test.setTimeout(300_000);
    const errors = collectBrowserErrors(page);
    await openCaptureTile(page);
    await expectSortedUniqueDiagnosticMaterials(page, "capture tile route");
    expect(errors).toEqual([]);
  });
});
