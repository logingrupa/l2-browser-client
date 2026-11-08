import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { stagedNativeTerrainPath } from "./stagedNativeTerrainPath";

const staged = existsSync(resolve("public/l2/catalog.json"));
const evidence = resolve("artifacts/private-preview/loading-panel");

const loadingPanelViewports = [
  { name: "desktop", options: { viewport: { width: 1440, height: 900 } } },
  { name: "mobile", options: { viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true } },
  { name: "portrait", options: { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true } },
];

for (const { name, options } of loadingPanelViewports) {
  test.describe(`loading panel at ${name} size`, () => {
    test.use(options);
    test(`loading panel shows the current step and pun while native terrain downloads at ${name} size`, async ({ page }) => {
      test.skip(!staged, "Requires the staged native asset store.");
      test.setTimeout(120_000);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const heldPath = stagedNativeTerrainPath();
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      await page.route(url => url.pathname === heldPath, async route => {
        const response = await route.fetch();
        await held;
        await route.fulfill({ response });
      });
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#loading-detail")).toHaveText("Preparing native terrain and scenery…", { timeout: 90_000 });
        await expect(page.locator("#loading")).toHaveAttribute("data-stage", "assets");
        await expect(page.locator("[data-loading-step='assets']")).toHaveAttribute("aria-current", "step");
        await expect(page.locator("#loading-pun")).toHaveText("No stone left unrendered.");
        await expect(page.locator("#loading-stage-status")).toHaveText("Loading meshes and textures");
        const bar = page.getByRole("progressbar");
        await expect(bar).toHaveAttribute("aria-label", "Loading meshes and textures");
        await expect(bar).toHaveAttribute("data-indeterminate", "true");
        await expect(page.locator("#loading-measure")).toHaveText("In progress");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const viewport = page.viewportSize()!;
        const bounds = await page.locator("#loading").boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: resolve(evidence, `${name}-loading.png`) });
      } finally { release(); }
      await expect(page.locator("#loading")).toHaveCount(0, { timeout: 90_000 });
    });
  });
}

test.describe("module download failure on a landscape phone", () => {
  test.use({ viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true });
  test("module download failure offers a working reload without jokes or a stuck progress bar", async ({ page }) => {
    test.skip(!staged, "Requires the staged native asset store.");
    test.setTimeout(120_000);
    let blockClient = true;
    await page.route(url => url.pathname === "/src/main.ts" || /^\/assets\/index-[^/]+\.js$/.test(url.pathname), async route => {
      if (blockClient) await route.fulfill({ status: 503, contentType: "text/javascript", body: "" });
      else await route.continue();
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert")).toContainText("game client could not be downloaded");
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.locator("#loading-pun")).toBeHidden();
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, "mobile-error.png") });
    blockClient = false;
    const retry = await page.getByRole("button", { name: "Reload and retry" }).boundingBox();
    expect(retry).not.toBeNull();
    await page.mouse.move(retry!.x + retry!.width / 2, retry!.y + retry!.height / 2);
    await page.mouse.down();
    await page.screenshot({ path: resolve(evidence, "mobile-error-pressed.png") });
    await page.mouse.up();
    await expect(page.locator("#loading")).toHaveCount(0, { timeout: 90_000 });
  });
});
