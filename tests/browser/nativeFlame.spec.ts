import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeSandboxConfiguration } from "../../src/runtime/nativeSandboxConfiguration";

const staged = existsSync(resolve("public/l2/catalog.json"));
const evidence = resolve(process.env.NATIVE_FLAME_EVIDENCE ?? "artifacts/native-parity/research/flame-runtime/browser");
const read = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native runtime is not ready.");
  return window.__nativeSlice.snapshot();
});
const observe = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  return { errors };
};
async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("#loading")).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.getByTestId("entity-count")).toHaveText("2", { timeout: 120_000 });
  await expect.poll(async () => (await read(page)).entities.filter(actor => actor.hasNativeModel).length, { timeout: 90_000 }).toBe(2);
  const initial = await read(page);
  expect(initial.worldFailure).toBeNull(); expect(initial.flameFailure).toBeNull();
  expect(initial.nativeFlames).toMatchObject({ status: "ready", nativeParity: "unverified",
    placementCounts: { declared: 12, eligible: 12, active: 12, skipped: 0, released: 0 } });
  expect(initial.nativeFlames?.materials).toMatchObject({ bindingCounts: { requested: 24, active: 24, skipped: 0, released: 0 },
    textureCount: 17, lighting: "unlit-encoded-color", nativeParity: "unverified" });
  expect(initial.nativeFlames?.billboards.reduce((sum, owner) => sum + owner.bindingCounts.active, 0)).toBe(12);
  expect(initial.world).toMatchObject({ modelCount: 62, placementCount: 157 });
  expect(initial.flameReplay?.nativeSynchronization).toBe("unverified");
  const { flameTextureRate: textureRate, flameFadeRate: fadeRate, flameTextureSeconds: textureStart, flameFadeSeconds: fadeStart } = nativeSandboxConfiguration;
  expect(initial.flameReplay?.textureRate).toBe(textureRate); expect(initial.flameReplay?.fadeRate).toBe(fadeRate);
  expect(initial.flameReplay!.textureSeconds).toBeGreaterThanOrEqual(textureStart);
  expect(initial.flameReplay!.fadeSeconds).toBeGreaterThanOrEqual(fadeStart);
  if (textureRate > 0 && fadeRate > 0) expect((initial.flameReplay!.textureSeconds - textureStart) / textureRate)
    .toBeCloseTo((initial.flameReplay!.fadeSeconds - fadeStart) / fadeRate, 8);
  await expect(page.getByTestId("fps")).toBeVisible();
  return initial;
}

test("native flames render and seek independently in the source desktop world", async ({ page }) => {
  test.skip(!staged, "Run pnpm assets:migrate --stage-runtime first.");
  test.setTimeout(180_000);
  const observed = observe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const initial = await ready(page);
  const firstTime = initial.nativeFlames!.materials!.current.textureSeconds;
  await expect.poll(async () => (await read(page)).nativeFlames?.materials?.current.textureSeconds).toBeGreaterThan(firstTime);
  await page.evaluate(() => {
    window.__nativeSlice!.dispatch({ type: "set-paused", isPaused: true });
    window.__nativeSlice!.setFlameReplay!({ textureSeconds: 0, fadeSeconds: 0 });
    window.__nativeSlice!.frameFlame!("interlude:20_20.StaticMeshActor1922");
  });
  await expect.poll(async () => (await read(page)).nativeFlames?.materials?.current.frameIndex).toBe(0);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "source-flame-frame0.png") });
  const zero = await read(page);
  expect(zero.nativeFlames?.materials?.current.textureSeconds).toBe(0);
  const invalidSeek = await page.evaluate(() => {
    try { window.__nativeSlice!.setFlameReplay!({ textureSeconds: 1e100, fadeSeconds: 0 }); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  });
  expect(invalidSeek).toContain("texture time exceeds");
  const afterRejected = await read(page);
  expect(afterRejected.nativeFlames?.placementCounts.active).toBe(12);
  expect(afterRejected.nativeFlames?.materials?.current).toEqual(zero.nativeFlames?.materials?.current);
  expect(afterRejected.flameFailure).toBeNull();
  await page.evaluate(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: .21, fadeSeconds: 0 }));
  const texture = await read(page);
  expect(texture.nativeFlames?.materials?.current.frameIndex).toBe(6);
  expect(texture.nativeFlames?.materials?.current.fadeRgbaBytes).toEqual(zero.nativeFlames?.materials?.current.fadeRgbaBytes);
  await page.screenshot({ path: resolve(evidence, "source-flame-frame6.png") });
  await page.evaluate(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: .21, fadeSeconds: .8 }));
  const fade = await read(page);
  expect(fade.nativeFlames?.materials?.current.frameIndex).toBe(6);
  expect(fade.nativeFlames?.materials?.current.fadeRgbaBytes).not.toEqual(zero.nativeFlames?.materials?.current.fadeRgbaBytes);
  await page.screenshot({ path: resolve(evidence, "source-flame-fade.png") });
  expect((await read(page)).nativeFlames?.materials?.current).toEqual(fade.nativeFlames?.materials?.current);
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-world").click();
  await page.getByRole("button", { name: "Follow fighter", exact: true }).click();
  await page.getByTestId("dev-sheet-toggle").click();
  await page.screenshot({ path: resolve(evidence, "source-desktop.png") });
  expect(observed.errors).toEqual([]);
  await writeFile(resolve(evidence, "source-desktop.json"), JSON.stringify({ initial, zero, texture, fade, observed,
    scope: "Real shader compilation and functional replay on WebGPU. Native lighting, clock synchronization, visual parity and hardware performance remain unverified." }, null, 2));
});

test.describe("Landscape phone flame preview", () => {
  test.use({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  test("source native flames and world remain usable with touch controls", async ({ page }) => {
    test.skip(!staged, "Run pnpm assets:migrate --stage-runtime first."); test.setTimeout(180_000);
    const observed = observe(page), initial = await ready(page);
    await page.getByRole("button", { name: "Run", exact: true }).tap();
    await expect.poll(async () => (await read(page)).entities.find(actor => actor.id === "local-player")?.animation).toBe("run");
    await page.getByTestId("dev-sheet-toggle").tap();
    await page.getByTestId("dev-tab-world").tap();
    await page.getByRole("button", { name: "Inspect flame", exact: true }).tap();
    await page.getByTestId("dev-tab-general").tap();
    await page.getByRole("button", { name: "Pause", exact: true }).tap();
    await page.getByTestId("dev-sheet-toggle").tap();
    await page.evaluate(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: .21, fadeSeconds: .8 }));
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, "source-mobile-flame.png") });
    await page.getByTestId("dev-sheet-toggle").tap();
    await page.getByTestId("dev-tab-world").tap();
    await page.getByRole("button", { name: "Follow fighter", exact: true }).tap();
    await page.getByRole("button", { name: "Idle", exact: true }).tap();
    await page.getByTestId("dev-sheet-toggle").tap();
    await page.screenshot({ path: resolve(evidence, "source-mobile-world.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(932);
    await page.setViewportSize({ width: 430, height: 932 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(430);
    expect(observed.errors).toEqual([]);
    await writeFile(resolve(evidence, "source-mobile.json"), JSON.stringify({ initial, final: await read(page), observed,
      scope: "Touch emulation, WebGPU functional check; not physical mobile performance or native visual acceptance." }, null, 2));
  });
});
