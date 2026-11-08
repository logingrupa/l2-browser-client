import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NativeSectionManifest } from "../../src/scene/world/loadNativeSection";
import { routeReferenceWorldAsNotStaged } from "./routeReferenceWorldAsNotStaged";

interface WebGPUProbe {
  contexts: string[]; devices: number; submissions: number; errors: string[];
  adapters: { vendor: string; architecture: string; device: string; description: string; fallback: boolean }[];
}

declare global {
  interface Window {
    __webgpuProbe?: WebGPUProbe;
    __webgpuProbeDevice?: GPUDevice;
    __rejectedWebGPUDeviceRequests?: number;
  }
}

async function observeGraphics(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: WebGPUProbe = window.__webgpuProbe = { contexts: [], devices: 0, submissions: 0, errors: [], adapters: [] };
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...options: unknown[]) {
        if (this.id === "canvas") probe.contexts.push(kind);
        return Reflect.apply(getContext, this, [kind, ...options]);
      },
    });
    if (typeof GPUAdapter === "undefined") return;
    const requestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
      const device = await requestDevice.call(this, descriptor);
      probe.devices++;
      const info = this.info;
      probe.adapters.push({ vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description,
        fallback: Boolean("isFallbackAdapter" in info && info.isFallbackAdapter) });
      window.__webgpuProbeDevice = device;
      device.addEventListener("uncapturederror", event => probe.errors.push(event.error.message));
      return device;
    };
    const submit = GPUQueue.prototype.submit;
    GPUQueue.prototype.submit = function (commands) {
      probe.submissions++;
      submit.call(this, commands);
    };
  });
}

async function graphicsSnapshot(page: Page) {
  return page.evaluate(async () => {
    await window.__webgpuProbeDevice?.queue.onSubmittedWorkDone();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
    return { ...window.__webgpuProbe!, engine: canvas?.dataset.engine,
      context: canvas?.dataset.engine === "WebGPU" && Boolean(canvas.getContext("webgpu")),
      readyFrame: Number(canvas?.dataset.readyFrame ?? 0) };
  });
}

function assertWebGPU(graphics: Awaited<ReturnType<typeof graphicsSnapshot>>) {
  expect(graphics.engine).toBe("WebGPU");
  expect(graphics.devices).toBeGreaterThan(0);
  expect(graphics.adapters).toHaveLength(graphics.devices);
  expect(graphics.context).toBe(true);
  expect(graphics.contexts).toContain("webgpu");
  expect(graphics.contexts.some(kind => /webgl/i.test(kind))).toBe(false);
  expect(graphics.readyFrame).toBeGreaterThan(0);
  expect(graphics.submissions).toBeGreaterThan(2);
  expect(graphics.errors).toEqual([]);
}

test.afterEach(async ({ page }, testInfo) => {
  const diagnostics = await page.evaluate(() => {
    const state = window.__nativeSlice?.snapshot(), world = state?.world;
    return { url: location.href, graphics: window.__webgpuProbe, engine: document.getElementById("canvas")?.dataset.engine,
      readyFrame: document.getElementById("canvas")?.dataset.readyFrame, worldState: document.body.dataset.worldState,
      loadingError: document.getElementById("loading-error")?.textContent,
      native: state ? { nativeTerrain: state.nativeTerrain, worldFailure: state.worldFailure,
        world: world ? { manifestSha256: world.manifestSha256, disposed: world.disposed, modelCount: world.modelCount,
          placementCount: world.placementCount, terrainTriangles: world.terrainTriangles, terrainMaterial: world.terrainMaterial,
          texturesReady: world.texturesReady, materialFailure: world.materialFailure } : null,
        actors: state.entities.map(actor => ({ id: actor.id, fallback: actor.isFallback, meshCount: actor.meshCount,
          activeClip: actor.playback?.activeClip })),
        flames: state.nativeFlames, flameFailure: state.flameFailure, materialOverrideFailure: state.materialOverride?.failure } : null };
  }).catch(error => ({ captureError: String(error) }));
  await testInfo.attach("webgpu-diagnostics", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" });
});

test("renders the code-built default scene using a real WebGPU device without WebGL fallback", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await observeGraphics(page);
  await routeReferenceWorldAsNotStaged(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveAttribute("data-world-state", "ready", { timeout: 90_000 });
  await expect(page.locator("#canvas")).toHaveAttribute("data-engine", "WebGPU");
  await expect(page.getByTestId("entity-count")).toHaveText("6");
  await expect.poll(() => page.evaluate(() => window.__webgpuProbe!.submissions)).toBeGreaterThan(2);
  assertWebGPU(await graphicsSnapshot(page));
  expect(errors).toEqual([]);
});

test("WebGPU device loss after entry reports failure without reviving a disposed world", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await observeGraphics(page);
  await routeReferenceWorldAsNotStaged(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveAttribute("data-world-state", "ready", { timeout: 90_000 });
  assertWebGPU(await graphicsSnapshot(page));
  await page.evaluate(() => window.__webgpuProbeDevice!.destroy());
  await expect(page.getByRole("alert")).toContainText(/WebGPU graphics connection/i);
  await expect(page.getByRole("button", { name: "Reload and retry" })).toBeVisible();
  await expect(page.locator("#canvas")).toBeHidden();
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
  expect(await page.evaluate(() => window.__webgpuProbe!.devices)).toBe(1);
  expect(errors).toEqual([]);
});

test("renders native terrain, actors and flame shaders on WebGPU in the source world", async ({ page }) => {
  const catalogPath = resolve("public/l2/catalog.json");
  test.skip(!existsSync(catalogPath), "Requires the locally staged native catalog.");
  test.setTimeout(240_000);
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as { sections: { id: string; manifest: string; manifestSha256: string }[] };
  const section = catalog.sections.find(section => section.id === "map-20-20-section");
  if (!section) throw new Error("The staged native world section is missing.");
  const bytes = readFileSync(resolve("public", section.manifest.slice(1)));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(section.manifestSha256);
  const manifest = JSON.parse(bytes.toString("utf8")) as NativeSectionManifest;
  const flamePlacements = manifest.placements.filter(placement => placement.sourceMesh === "FX_E_S.Flameset.Default_Flame01");
  expect(flamePlacements.length).toBeGreaterThan(0);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await observeGraphics(page);
  await page.goto("/?world=interlude", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveAttribute("data-world-state", "ready", { timeout: 180_000 });
  await expect(page.locator("#canvas")).toHaveAttribute("data-engine", "WebGPU");
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#loading")).toHaveCount(0);
  await expect(page.getByTestId("entity-count")).toHaveText("2");
  const initial = await page.evaluate(() => window.__nativeSlice!.snapshot());
  expect(initial.nativeTerrain).toBe("source-section-loaded");
  expect(initial.worldFailure).toBeNull();
  expect(initial.world).toMatchObject({ manifestSha256: section.manifestSha256, disposed: false, modelCount: manifest.models.length,
    placementCount: manifest.placements.length, texturesReady: true, finiteBounds: true, materialFailure: null,
    terrainMaterial: "candidate-source-textures" });
  expect(initial.world!.terrainTriangles).toBeGreaterThan(0);
  expect(initial.entities).toHaveLength(2);
  for (const actor of initial.entities) {
    expect(actor.isFallback).toBe(false);
    expect(actor.meshCount).toBeGreaterThan(0);
    expect(actor.skeletons.some(skeleton => skeleton.bones > 0)).toBe(true);
    expect(actor.playback?.activeClip).toBeTruthy();
  }
  expect(initial.materialOverride?.failure).toBeNull();
  expect(initial.flameFailure).toBeNull();
  expect(initial.nativeFlames).toMatchObject({ status: "ready", failure: null, disposed: false,
    placementCounts: { declared: flamePlacements.length, eligible: flamePlacements.length, active: flamePlacements.length, skipped: 0, released: 0 },
    materials: { disposed: false, errors: [], bindingCounts: { requested: flamePlacements.length * 2,
      active: flamePlacements.length * 2, skipped: 0, released: 0 } } });
  assertWebGPU(await graphicsSnapshot(page));

  const submissions = await page.evaluate(placementId => {
    const runtime = window.__nativeSlice!;
    if (!runtime.frameFlame || !runtime.setFlameReplay) throw new Error("Native flame rendering controls are missing.");
    runtime.dispatch({ type: "set-paused", isPaused: true });
    runtime.setFlameReplay({ textureSeconds: .21, fadeSeconds: .8 });
    runtime.frameFlame(placementId);
    return window.__webgpuProbe!.submissions;
  }, flamePlacements[0]!.id);
  await expect.poll(() => page.evaluate(() => window.__webgpuProbe!.submissions), { timeout: 30_000 }).toBeGreaterThan(submissions + 2);
  const final = await page.evaluate(() => window.__nativeSlice!.snapshot());
  expect(final.flameFailure).toBeNull();
  expect(final.nativeFlames?.materials?.errors).toEqual([]);
  expect(final.nativeFlames?.materials?.current.frameIndex).toBe(6);
  assertWebGPU(await graphicsSnapshot(page));
  expect(errors).toEqual([]);
});

for (const failure of ["unavailable", "device request rejected"] as const) {
  test(`WebGPU ${failure} shows an actionable startup error without loading the world or falling back`, async ({ page }) => {
    const pageErrors: string[] = [], worldRequests: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/assets/world/") || path.startsWith("/l2/")) worldRequests.push(request.url());
    });
    await observeGraphics(page);
    await page.addInitScript(failure => {
      if (failure === "unavailable") Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined });
      else {
        window.__rejectedWebGPUDeviceRequests = 0;
        GPUAdapter.prototype.requestDevice = async () => {
          window.__rejectedWebGPUDeviceRequests!++;
          throw new Error("Injected WebGPU device request failure");
        };
      }
    }, failure);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert")).toContainText(/WebGPU/i, { timeout: 30_000 });
    if (failure === "device request rejected") {
      expect(await page.evaluate(() => window.__rejectedWebGPUDeviceRequests), "The actual requestDevice boundary must be reached; an unavailable adapter is a different failure.").toBe(1);
      await expect(page.getByRole("alert")).toContainText(/initialized/i);
    }
    await expect(page.getByRole("button", { name: "Reload and retry" })).toBeVisible();
    await expect(page.locator("#canvas")).toBeHidden();
    expect(await page.evaluate(() => document.getElementById("canvas")!.dataset.engine)).toBeUndefined();
    const graphics = await page.evaluate(() => window.__webgpuProbe!);
    expect(graphics.contexts.some(kind => /webgl/i.test(kind))).toBe(false);
    expect(graphics.devices).toBe(0);
    expect(graphics.submissions).toBe(0);
    expect(worldRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}
