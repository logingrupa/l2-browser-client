import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const sceneFile = resolve("public/scene/native-world.babylon");
const staged = existsSync(sceneFile);
const evidence = resolve("artifacts/private-preview/loading-panel");

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 320, height: 568 }, { name: "landscape", width: 667, height: 375 }]) {
  test(`loading panel shows measured progress, steps and puns at ${viewport.name} size`, async ({ page }) => {
    test.skip(!staged, "Requires the staged authored native scene.");
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const scene = JSON.parse(readFileSync(sceneFile, "utf8")) as { meshes: { delayLoadingFile?: string }[] };
    const resource = scene.meshes.find(mesh => mesh.delayLoadingFile)?.delayLoadingFile;
    expect(resource).toBeTruthy();
    const heldPath = new URL(resource!, "http://localhost/scene/").pathname;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(url => url.pathname === heldPath, async route => {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    });
    try {
      await page.goto("/?world=interlude&authored=1", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#loading")).toHaveAttribute("data-stage", "assets", { timeout: 90_000 });
      await expect(page.locator("[data-loading-step='assets']")).toHaveAttribute("aria-current", "step");
      await expect(page.locator("#loading-pun")).toHaveText("No stone left unrendered.");
      const bar = page.getByRole("progressbar");
      await expect(bar).toHaveAttribute("aria-label", "Scene items ready");
      await expect.poll(async () => Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
      expect(Number(await bar.getAttribute("aria-valuenow"))).toBeLessThan(100);
      await expect(page.locator("#loading-detail")).toContainText("scene items ready");
      await expect(page.locator("#loading-measure")).toContainText("of this step");
      await expect(page.locator("#loading-stage-status")).toHaveText("Loading meshes and textures");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const bounds = await page.locator("#loading").boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: resolve(evidence, `${viewport.name}-loading.png`) });
    } finally { release(); }
    await expect(page.locator("#loading")).toHaveCount(0, { timeout: 90_000 });
  });
}

test("module download failure offers a working reload without jokes or a stuck progress bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let blockClient = true;
  await page.route(url => url.pathname === "/src/main.ts" || /^\/assets\/index-[^/]+\.js$/.test(url.pathname), async route => {
    if (blockClient) await route.fulfill({ status: 503, contentType: "text/javascript", body: "" });
    else await route.continue();
  });
  await page.goto("/?world=courtyard", { waitUntil: "domcontentloaded" });
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
