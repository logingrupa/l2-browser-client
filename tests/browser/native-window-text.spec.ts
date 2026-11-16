import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";

const laneName = "integration";
const laneStoreRoot = resolve("artifacts/lane-store", laneName);
const laneCatalogPath = resolve(laneStoreRoot, "l2/catalog.json");
const evidenceDirectory = resolve("artifacts/ui-evidence");
const fontRecordIdPrefix = "ui-font:";

interface LaneRecord { readonly id: string; readonly manifest: string }
interface LaneCatalog { readonly windows?: readonly LaneRecord[]; readonly fonts?: readonly LaneRecord[] }
interface FontManifest { readonly atlas: { readonly image: string } }
interface TextWindowCase { readonly windowId: string; readonly fontType: number; readonly route: string }

const textWindowCases: readonly TextWindowCase[] = [
  { windowId: "StatusWnd", fontType: 10, route: "digit atlas" },
  { windowId: "ItemEnchantWnd", fontType: 0, route: "bitmap glyph table" },
];

const laneCatalog: LaneCatalog | undefined = existsSync(laneCatalogPath) ? JSON.parse(readFileSync(laneCatalogPath, "utf8")) as LaneCatalog : undefined;

function fontAtlasImagePath(fontType: number): string | undefined {
  const record = laneCatalog?.fonts?.find(candidate => candidate.id === fontRecordIdPrefix + fontType);
  if (record === undefined) return undefined;
  return (JSON.parse(readFileSync(resolve(laneStoreRoot, `.${record.manifest}`), "utf8")) as FontManifest).atlas.image;
}

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=integration");

for (const textWindowCase of textWindowCases) {
  test(`${textWindowCase.windowId} draws its decoded TextBox text with the converted ${textWindowCase.route} font at 1440 x 900`, async ({ browser }) => {
    const atlasImagePath = fontAtlasImagePath(textWindowCase.fontType);
    test.skip(atlasImagePath === undefined || !laneCatalog?.windows?.some(record => record.id === textWindowCase.windowId),
      `${textWindowCase.windowId} or ui-font:${textWindowCase.fontType} is not in the integration union store`);
    const context = await browser.newContext({ viewport: desktopViewport });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      const fetchedPaths = new Set<string>();
      page.on("pageerror", error => pageErrors.push(error.message));
      page.on("response", response => { if (response.ok()) fetchedPaths.add(new URL(response.url()).pathname); });
      await page.goto(`/tests/browser/harness/native-window.html?window=${textWindowCase.windowId}`);
      await expect(page.locator("#native-window-harness")).toHaveAttribute("data-status", /^(opened|not-in-catalog|failed)$/, { timeout: 30_000 });
      expect(await page.evaluate(() => window.__nativeWindowHarness?.result.reason ?? null)).toBeNull();
      expect(pageErrors).toEqual([]);
      const windowRoot = page.locator(`[data-native-window="${textWindowCase.windowId}"]`);
      await expect(windowRoot.locator('[data-native-text="drawn"]').first()).toBeVisible();
      expect(await windowRoot.locator("[data-native-glyph]").count()).toBeGreaterThan(0);
      expect(fetchedPaths.has(atlasImagePath!)).toBe(true);
      const firstGlyphStyle = await windowRoot.locator("[data-native-glyph]").first().evaluate(glyph => {
        const style = getComputedStyle(glyph);
        return { backgroundImage: style.backgroundImage, maskImage: style.maskImage, blendMode: style.backgroundBlendMode };
      });
      expect(firstGlyphStyle.backgroundImage).toMatch(/^url\("blob:/);
      expect(firstGlyphStyle.maskImage).toMatch(/^url\("blob:/);
      expect(firstGlyphStyle.blendMode).toBe("multiply");
      mkdirSync(evidenceDirectory, { recursive: true });
      await page.screenshot({ path: resolve(evidenceDirectory, `03-32-${textWindowCase.windowId}-desktop.png`) });
    } finally {
      await context.close();
    }
  });
}
