import { expect, test, type Page, type Route } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeSandboxConfiguration } from "../../src/runtime/nativeSandboxConfiguration";
import { stagedNativeTerrainPath } from "./stagedNativeTerrainPath";

const catalogFile = resolve("public/l2/catalog.json");
const staged = existsSync(catalogFile);
const evidence = resolve(process.env.NATIVE_REVEAL_EVIDENCE ?? "artifacts/private-preview/native-reveal");
const route = "/?world=interlude";
const starterMaterial = "MFighter.UpBody.MFighter_m001_t02_u";
const leatherMaterial = "MFighter.UpBody.MFighter_m001_t04_u";

interface RevealSample {
  time: number;
  source: "frame" | "mutation";
  loaderPresent: boolean;
  loaderVisible: boolean;
  canvasVisible: boolean;
  hudVisible: boolean;
  readyFrame: number;
  worldState: string | null;
  terrainReady: boolean;
  nativeActorCount: number;
  fallbackCount: number;
  equipmentReady: boolean;
  hudReady: boolean;
  complete: boolean;
}

declare global {
  interface Window {
    __nativeRevealDevice?: GPUDevice;
    __nativeRevealTest?: {
      samples: RevealSample[];
      firstReveal: RevealSample | null;
      violations: RevealSample[];
      frameCount: number;
      stop(): void;
    };
  }
}

function inputs() {
  const catalog = JSON.parse(readFileSync(catalogFile, "utf8")) as {
    models: { id: string; archive: string }[]; sections: { id: string; manifest: string }[] };
  const section = catalog.sections.find(item => item.id === "map-20-20-section");
  if (!section) throw new Error("The staged native world section is missing.");
  const manifest = JSON.parse(readFileSync(resolve("public", section.manifest.slice(1)), "utf8")) as { models: unknown[]; placements: unknown[] };
  const packages = ["human-male-fighter:0", "fighter-equipment:0", "musveren:0"].map(id => {
    const model = catalog.models.find(entry => entry.id === id);
    if (!model) throw new Error(`The staged native model ${id} is missing.`);
    return model;
  });
  return {
    terrain: stagedNativeTerrainPath(),
    leather: nativeSandboxConfiguration.leatherShirt,
    sectionCounts: { models: manifest.models.length, placements: manifest.placements.length },
    packages,
  };
}

async function observeReveal(page: Page, leather: boolean, sectionCounts: { models: number; placements: number }) {
  await page.addInitScript(({ leather, starterMaterial, leatherMaterial, sectionCounts }) => {
    const visible = (element: Element | null): boolean => {
      if (!element || !element.getClientRects().length) return false;
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    let seenLoader = false, stopped = false, frame = 0;
    const record = (source: "frame" | "mutation") => {
      const loader = document.getElementById("loading");
      if (loader) seenLoader = true;
      if (!seenLoader) return;
      const canvasVisible = visible(document.getElementById("canvas"));
      const hudVisible = visible(document.querySelector(".world-interface"));
      const snapshot = !loader || canvasVisible || hudVisible ? window.__nativeSlice?.snapshot() : undefined;
      const entities = snapshot?.entities ?? [];
      const fighter = entities.find(entity => entity.id === "local-player");
      const terrainReady = Boolean(snapshot?.nativeTerrain === "source-section-loaded" && snapshot.world &&
        snapshot.world.texturesReady && snapshot.world.terrainTriangles > 0 && snapshot.world.modelCount === sectionCounts.models &&
        snapshot.world.placementCount === sectionCounts.placements && snapshot.world.finiteBounds && !snapshot.worldFailure && !snapshot.world.materialFailure);
      const nativeActorCount = entities.filter(entity => !entity.isFallback && entity.meshCount > 0 &&
        entity.skeletons.some(skeleton => skeleton.bones > 0) && Boolean(entity.playback?.activeClip)).length;
      const equipmentReady = Boolean(fighter?.parts.some(part => part.enabled && part.material === (leather ? leatherMaterial : starterMaterial)) &&
        (!leather || fighter.parts.some(part => !part.enabled && part.material === starterMaterial)));
      const hudReady = document.querySelector('[data-testid="entity-count"]')?.textContent === "2" &&
        Boolean(document.querySelector('[data-testid="player-health"]')?.textContent?.includes(" / "));
      const readyFrame = Number(document.getElementById("canvas")?.dataset.readyFrame ?? 0);
      const worldState = document.body?.dataset.worldState ?? null;
      const value: RevealSample = { time: performance.now(), source, loaderPresent: Boolean(loader), loaderVisible: visible(loader),
        canvasVisible, hudVisible, readyFrame, worldState, terrainReady, nativeActorCount, fallbackCount: entities.filter(entity => entity.isFallback).length,
        equipmentReady, hudReady, complete: terrainReady && entities.length === 2 && nativeActorCount === 2 && equipmentReady && hudReady &&
          readyFrame > 0 && worldState === "ready" };
      state.samples.push(value);
      if ((loader && (canvasVisible || hudVisible)) || (!loader && (!value.complete || !canvasVisible || !hudVisible))) state.violations.push(value);
      if (!loader && !state.firstReveal) state.firstReveal = value;
    };
    const observer = new MutationObserver(records => {
      if (records.some(record => [...record.removedNodes].some(node => node instanceof Element &&
        (node.id === "loading" || node.querySelector("#loading"))))) record("mutation");
    });
    observer.observe(document, { childList: true, subtree: true });
    const tick = () => {
      if (stopped) return;
      state.frameCount++;
      record("frame");
      frame = requestAnimationFrame(tick);
    };
    const state: NonNullable<Window["__nativeRevealTest"]> = { samples: [], firstReveal: null, violations: [], frameCount: 0,
      stop() { stopped = true; cancelAnimationFrame(frame); observer.disconnect(); } };
    window.__nativeRevealTest = state;
    frame = requestAnimationFrame(tick);
  }, { leather, starterMaterial, leatherMaterial, sectionCounts });
}

async function frames(page: Page, count = 4) {
  await page.evaluate(count => new Promise<void>(resolve => {
    const tick = () => { if (--count === 0) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), count);
}

async function hold(page: Page, path: string) {
  let release!: () => void, requested = false;
  const released = new Promise<void>(resolve => { release = resolve; });
  const errors: string[] = [];
  const handler = async (request: Route) => {
    requested = true;
    try {
      const response = await request.fetch();
      await released;
      await request.fulfill({ response });
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  };
  await page.route(url => url.pathname === path, handler);
  return { path, release, errors, requested: () => requested };
}

async function assertCompleteReveal(page: Page) {
  await expect(page.locator("#loading")).toHaveCount(0, { timeout: 120_000 });
  await frames(page, 6);
  const observation = await page.evaluate(() => {
    const result = window.__nativeRevealTest!;
    result.stop();
    return { samples: result.samples, firstReveal: result.firstReveal, violations: result.violations, frameCount: result.frameCount };
  });
  expect(observation.firstReveal, "The loader removal must itself be observed.").not.toBeNull();
  expect(observation.firstReveal!.source).toBe("mutation");
  expect(observation.firstReveal!.complete, "The first exposed frame requires terrain, native actors, saved equipment and initialized HUD.").toBe(true);
  expect(observation.firstReveal!.fallbackCount).toBe(0);
  expect(observation.violations, "No frame may expose an unfinished world or procedural fallback.").toEqual([]);
  return observation;
}

const revealViewports = [
  { name: "desktop", options: { viewport: { width: 1440, height: 900 } } },
  { name: "mobile", options: { viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true } },
];

for (const { name, options } of revealViewports) {
  test.describe(`native reveal at ${name} size`, () => {
    test.use(options);
    test(`native scene stays concealed through delayed catalog, fighter, equipment and terrain at ${name} size`, async ({ page }, testInfo) => {
      test.skip(!staged, "Requires the locally staged native asset store.");
      test.setTimeout(240_000);
      const source = inputs();
      const directory = resolve(evidence, `${testInfo.project.name}-${name}`);
      await mkdir(directory, { recursive: true });
      await observeReveal(page, source.leather, source.sectionCounts);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      const paths = [{ name: "catalog", path: "/l2/catalog.json" },
        ...source.packages.map(model => ({ name: model.id.replace(/[^a-z0-9-]/g, "-"), path: model.archive })),
        { name: "terrain", path: source.terrain }];
      const gates = await Promise.all(paths.map(item => hold(page, item.path)));
      try {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        for (const [index, gate] of gates.entries()) {
          await expect.poll(gate.requested, { timeout: 120_000 }).toBe(true);
          await frames(page);
          await expect(page.locator("#loading")).toBeVisible();
          await expect(page.locator("#canvas")).toBeHidden();
          await expect(page.locator(".world-interface")).toBeHidden();
          expect(await page.evaluate(() => window.__nativeRevealTest!.firstReveal)).toBeNull();
          await page.screenshot({ path: resolve(directory, `held-${paths[index]!.name}.png`) });
          gate.release();
        }
        const observation = await assertCompleteReveal(page);
        await page.screenshot({ path: resolve(directory, "after-loader.png") });
        const snapshot = await page.evaluate(() => window.__nativeSlice!.snapshot());
        await writeFile(resolve(directory, "transition.json"), JSON.stringify({ viewport: page.viewportSize(), observation, snapshot, heldPaths: paths, errors }, null, 2));
        await testInfo.attach("startup-transition", { path: resolve(directory, "transition.json"), contentType: "application/json" });
        expect(gates.flatMap(gate => gate.errors)).toEqual([]);
        expect(errors).toEqual([]);
        await page.setViewportSize({ width: 430, height: 932 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(430);
      } finally { gates.forEach(gate => gate.release()); }
    });
  });
}

test.describe("native fighter package failure on a landscape phone", () => {
  test.use({ viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true });
  test("failed native fighter package retains the loading error and reload retries without revealing dummies", async ({ page }, testInfo) => {
    test.skip(!staged, "Requires the locally staged native asset store.");
    test.setTimeout(240_000);
    const source = inputs(), fighter = source.packages.find(item => item.id === "human-male-fighter:0")!;
    const directory = resolve(evidence, `${testInfo.project.name}-retry`);
    await mkdir(directory, { recursive: true });
    await observeReveal(page, source.leather, source.sectionCounts);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let blocked = true, failures = 0;
    await page.route(url => url.pathname === fighter.archive, async request => {
      if (blocked) { failures++; await request.fulfill({ status: 502, contentType: "text/plain", body: "Intentional native package failure" }); }
      else await request.continue();
    });
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert")).toContainText(/native/i, { timeout: 120_000 });
    await expect(page.getByRole("button", { name: "Reload and retry" })).toBeVisible();
    await expect(page.locator("#canvas")).toBeHidden();
    await expect(page.locator(".world-interface")).toBeHidden();
    expect(failures).toBeGreaterThan(0);
    const failure = await page.evaluate(() => ({ firstReveal: window.__nativeRevealTest!.firstReveal, violations: window.__nativeRevealTest!.violations,
      runtimePresent: Boolean(window.__nativeSlice) }));
    expect(failure).toEqual({ firstReveal: null, violations: [], runtimePresent: false });
    await page.screenshot({ path: resolve(directory, "native-package-error.png") });
    blocked = false;
    await page.getByRole("button", { name: "Reload and retry" }).click();
    const observation = await assertCompleteReveal(page);
    await page.screenshot({ path: resolve(directory, "retried-native-world.png") });
    await writeFile(resolve(directory, "transition.json"), JSON.stringify({ failure, observation, failures, errors }, null, 2));
    expect(errors).toEqual([]);
  });
});

test("graphics context loss during native startup reports failure without revealing the scene", async ({ page }, testInfo) => {
  test.skip(!staged, "Requires the locally staged native asset store.");
  test.setTimeout(180_000);
  const source = inputs();
  await observeReveal(page, source.leather, source.sectionCounts);
  await page.addInitScript(() => {
    const requestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
      const device = await requestDevice.call(this, descriptor);
      window.__nativeRevealDevice = device;
      return device;
    };
  });
  const gate = await hold(page, "/l2/catalog.json");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect.poll(gate.requested, { timeout: 120_000 }).toBe(true);
    const lost = await page.evaluate(() => {
      const device = window.__nativeRevealDevice;
      if (!device) return false;
      device.destroy(); return true;
    });
    expect(lost, "The regression must destroy the actual WebGPU device used by the world.").toBe(true);
    await expect(page.getByRole("alert")).toContainText(/graphics|context/i, { timeout: 30_000 });
    await expect(page.locator("#loading")).toBeVisible();
    await expect(page.locator("#canvas")).toBeHidden();
    await expect(page.locator(".world-interface")).toBeHidden();
    expect(await page.evaluate(() => window.__nativeRevealTest!.firstReveal)).toBeNull();
    expect(await page.evaluate(() => window.__nativeRevealTest!.violations)).toEqual([]);
    const directory = resolve(evidence, `${testInfo.project.name}-context-loss`);
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, "loading-error.png") });
    expect(errors).toEqual([]);
  } finally { gate.release(); }
});

test("a failed runtime terrain download cannot reveal the native actor inspection fallback", async ({ page }, testInfo) => {
  test.skip(!staged, "Requires the locally staged native asset store.");
  test.setTimeout(180_000);
  const source = inputs(), terrain = source.terrain;
  await observeReveal(page, false, source.sectionCounts);
  const errors: string[] = [];
  let failures = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route(url => url.pathname === terrain, async request => {
    failures++;
    await request.fulfill({ status: 502, contentType: "text/plain", body: "Intentional runtime terrain failure" });
  });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Reload and retry" })).toBeVisible();
  await expect(page.locator("#canvas")).toBeHidden();
  await expect(page.locator(".world-interface")).toBeHidden();
  expect(failures).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__nativeRevealTest!.firstReveal)).toBeNull();
  expect(await page.evaluate(() => window.__nativeRevealTest!.violations)).toEqual([]);
  expect(await page.evaluate(() => window.__nativeSlice === undefined)).toBe(true);
  const directory = resolve(evidence, `${testInfo.project.name}-terrain-failure`);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, "loading-error.png") });
  expect(errors).toEqual([]);
});
