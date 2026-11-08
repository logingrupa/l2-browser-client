import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { collectBrowserErrors } from "./browserErrors";

const staged = existsSync(resolve("public/l2/catalog.json"));
const evidence = resolve(process.env.NATIVE_FLAME_EVIDENCE ?? "artifacts/native-parity/research/flame-runtime/browser");
const read = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native runtime is not ready.");
  return window.__nativeSlice.snapshot();
});
const observe = (page: Page) => {
  const errors = collectBrowserErrors(page), requests: string[] = [];
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  return { errors, requests };
};
async function ready(page: Page, authored: boolean) {
  await page.goto(`/${authored ? "?authored=1" : ""}`);
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
  const saved = JSON.parse(await readFile(resolve(`assets/${authored ? "native-world" : "native-parity"}.scene/config.json`), "utf8")) as {
    metadata: { scripts: { _id: string; key: string; values: Record<string, { type: string; value: unknown }> }[] } };
  const values = saved.metadata.scripts.find(script => script._id === "native-parity-runtime" && script.key === "scripts/nativeParity.ts")!.values;
  const number = (key: string, fallback: number) => {
    if (!values[key]) return fallback;
    expect(values[key]!.type).toBe("number"); expect(typeof values[key]!.value).toBe("number");
    return values[key]!.value as number;
  };
  const textureRate = number("flameTextureRate", 1), fadeRate = number("flameFadeRate", 1);
  const textureStart = number("flameTextureSeconds", 0), fadeStart = number("flameFadeSeconds", 0);
  expect(initial.flameReplay?.textureRate).toBe(textureRate); expect(initial.flameReplay?.fadeRate).toBe(fadeRate);
  expect(initial.flameReplay!.textureSeconds).toBeGreaterThanOrEqual(textureStart);
  expect(initial.flameReplay!.fadeSeconds).toBeGreaterThanOrEqual(fadeStart);
  if (textureRate > 0 && fadeRate > 0) expect((initial.flameReplay!.textureSeconds - textureStart) / textureRate)
    .toBeCloseTo((initial.flameReplay!.fadeSeconds - fadeStart) / fadeRate, 8);
  await expect(page.getByTestId("fps")).toBeVisible();
  return initial;
}

for (const authored of [false, true]) test(`native flames render and seek independently in the ${authored ? "authored" : "source"} desktop world`, async ({ page }) => {
  test.skip(!staged, "Run pnpm assets:migrate --stage-runtime first.");
  test.setTimeout(180_000);
  const observed = observe(page), label = authored ? "authored" : "source";
  await page.setViewportSize(desktopViewport);
  const initial = await ready(page, authored);
  const firstTime = initial.nativeFlames!.materials!.current.textureSeconds;
  await expect.poll(async () => (await read(page)).nativeFlames?.materials?.current.textureSeconds).toBeGreaterThan(firstTime);
  await page.evaluate(() => {
    window.__nativeSlice!.dispatch({ type: "set-paused", isPaused: true });
    window.__nativeSlice!.setFlameReplay!({ textureSeconds: 0, fadeSeconds: 0 });
    window.__nativeSlice!.frameFlame!("interlude:20_20.StaticMeshActor1922");
  });
  await expect.poll(async () => (await read(page)).nativeFlames?.materials?.current.frameIndex).toBe(0);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${label}-flame-frame0.png`) });
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
  await page.screenshot({ path: resolve(evidence, `${label}-flame-frame6.png`) });
  await page.evaluate(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: .21, fadeSeconds: .8 }));
  const fade = await read(page);
  expect(fade.nativeFlames?.materials?.current.frameIndex).toBe(6);
  expect(fade.nativeFlames?.materials?.current.fadeRgbaBytes).not.toEqual(zero.nativeFlames?.materials?.current.fadeRgbaBytes);
  await page.screenshot({ path: resolve(evidence, `${label}-flame-fade.png`) });
  expect((await read(page)).nativeFlames?.materials?.current).toEqual(fade.nativeFlames?.materials?.current);
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-world").click();
  await page.getByRole("button", { name: "Follow fighter", exact: true }).click();
  await page.getByTestId("dev-sheet-toggle").click();
  await page.screenshot({ path: resolve(evidence, `${label}-desktop.png`) });
  expect(observed.errors).toEqual([]);
  if (authored) expect(observed.requests.filter(path => /\/map-section(?:-models)?\/.*\.glb$/.test(path))).toEqual([]);
  await writeFile(resolve(evidence, `${label}-desktop.json`), JSON.stringify({ initial, zero, texture, fade, observed,
    scope: "Real shader compilation and functional replay on WebGPU. Native lighting, clock synchronization, visual parity and hardware performance remain unverified." }, null, 2));
});

test.describe("Mobile flame preview", () => {
  test.use(landscapePhone);
  test("authored native flames and world remain usable with touch controls", async ({ page }) => {
    test.skip(!staged, "Run pnpm assets:migrate --stage-runtime first."); test.setTimeout(180_000);
    const observed = observe(page), initial = await ready(page, true);
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
    await page.screenshot({ path: resolve(evidence, "authored-mobile-flame.png") });
    await page.getByTestId("dev-sheet-toggle").tap();
    await page.getByTestId("dev-tab-world").tap();
    await page.getByRole("button", { name: "Follow fighter", exact: true }).tap();
    await page.getByRole("button", { name: "Idle", exact: true }).tap();
    await page.getByTestId("dev-sheet-toggle").tap();
    await page.screenshot({ path: resolve(evidence, "authored-mobile-world.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(landscapePhone.viewport.width);
    await expectNoHorizontalScrollOnPortraitPhone(page);
    expect(observed.errors).toEqual([]);
    await writeFile(resolve(evidence, "authored-mobile.json"), JSON.stringify({ initial, final: await read(page), observed,
      scope: "Touch emulation, WebGPU functional check; not physical mobile performance or native visual acceptance." }, null, 2));
  });
});

test("a corrupt flame archive keeps the authored world concealed until a successful retry", async ({ page }) => {
  test.skip(!staged, "Run pnpm assets:migrate --stage-runtime first."); test.setTimeout(240_000);
  const catalog = JSON.parse(await readFile(resolve("public/l2/catalog.json"), "utf8")) as { sections: { manifest: string }[] };
  const manifest = JSON.parse(await readFile(resolve("public", catalog.sections[0]!.manifest.slice(1)), "utf8")) as {
    models: { sourceObject: string; archive: { sha256: string } }[] };
  const flame = manifest.models.find(model => model.sourceObject === "FX_E_S.Flameset.Default_Flame01")!;
  const observed = observe(page);
  let corrupt = true, intercepted = 0;
  await page.route(`**/${flame.archive.sha256}/asset.l2asset`, async route => {
    if (corrupt) {
      intercepted++;
      await route.fulfill({ contentType: "application/octet-stream", body: Buffer.from("corrupt fixture") });
    } else await route.continue();
  });
  await page.goto("/?authored=1");
  await expect(page.getByRole("alert")).toContainText("archive hash/length differs.", { timeout: 120_000 });
  await expect(page.locator("#loading")).toHaveAttribute("data-state", "error");
  await expect(page.getByRole("button", { name: "Reload and retry" })).toBeVisible();
  await expect(page.locator("#canvas")).toBeHidden();
  await expect(page.locator(".world-interface")).toBeHidden();
  await expect(page.getByTestId("entity-count")).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeSlice === undefined)).toBe(true);
  expect(intercepted).toBeGreaterThan(0);
  const failure = await page.getByRole("alert").textContent();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "corrupt-archive-loading-error.png") });
  corrupt = false;
  await page.getByRole("button", { name: "Reload and retry" }).click();
  await expect(page.locator("#loading")).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId("entity-count")).toHaveText("2");
  const state = await read(page);
  expect(state.entities).toHaveLength(2); expect(state.entities.every(actor => actor.hasNativeModel)).toBe(true);
  expect(state.worldFailure).toBeNull(); expect(state.world?.placementCount).toBe(157);
  expect(state.flameFailure).toBeNull(); expect(state.nativeFlames?.status).toBe("ready");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(async () => (await read(page)).entities.find(actor => actor.id === "local-player")?.animation).toBe("run");
  expect(observed.errors).toEqual([]);
  await writeFile(resolve(evidence, "corrupt-archive-error-and-retry.json"), JSON.stringify({ failure, intercepted, state, observed }, null, 2));
});
