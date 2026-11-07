import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ImportedWorldInspection } from "../../src/scene/world/loadImportedWorld";

const staged = existsSync(resolve("public/assets/world/manifest.json"));
const evidence = resolve("artifacts/world-integration");
declare global {
  interface Window {
    __worldWebGPUInfo?: { vendor: string; architecture: string; device: string; description: string };
  }
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    if (!window.__worldDiagnostics) throw new Error("World runtime is not ready.");
    return window.__worldDiagnostics.snapshot();
  });
}

test("enters the imported island with grounded characters and keeps scenery stable during camera movement", async ({ page }) => {
  test.skip(!staged, "Run pnpm world:stage to verify the actual imported island.");
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => {
    const requestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
      const device = await requestDevice.call(this, descriptor);
      const info = this.info;
      window.__worldWebGPUInfo = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
      return device;
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("entity-count")).toHaveText("6", { timeout: 150_000 });
  await expect.poll(async () => {
    const state = await snapshot(page);
    return (state.environment.world as ImportedWorldInspection).activeLoads;
  }, { timeout: 90_000 }).toBe(0);
  await expect.poll(async () => (await snapshot(page)).entities.filter(entity => !entity.isFallback).length, { timeout: 60_000 }).toBe(3);
  const initial = await snapshot(page);
  const world = initial.environment.world as ImportedWorldInspection;
  expect(initial.environment.mode).toBe("island");
  expect(initial.environment.cameraRelative).toBe(true);
  expect(world.surface.ready).toBe(true);
  expect(world.surface.texturedTiles).toBe(4);
  expect(world.surface.method).toBe("source-layers");
  expect(world.errors).toEqual([]);
  expect(world.visiblePlacements).toBeGreaterThan(50);
  expect(world.sourcePlacements).toBe(45571);
  expect(initial.entities.every(entity => entity.position.x > 4500 && entity.position.y < -60 && entity.position.y > -80)).toBe(true);
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const player = initial.entities.find(entity => entity.id === "local-player")!;
  await page.getByRole("button", { name: "Select Elyra", exact: true }).click();
  await expect(page.getByTestId("target-name")).toHaveText("Elyra");
  await page.getByRole("button", { name: "Teleport", exact: true }).click();
  await expect.poll(async () => {
    const local = (await snapshot(page)).entities.find(entity => entity.id === "local-player")!;
    return Math.hypot(local.position.x - player.position.x, local.position.z - player.position.z);
  }).toBeGreaterThan(1);
  const teleported = (await snapshot(page)).entities.find(entity => entity.id === "local-player")!;
  expect(teleported.position.y).not.toBe(0);
  expect(teleported.position.x).toBeCloseTo(teleported.authoritativePosition.x, 4);
  await page.getByRole("button", { name: "Spawn", exact: true }).click();
  await expect(page.getByTestId("entity-count")).toHaveText("7");
  const spawned = (await snapshot(page)).entities.find(entity => entity.id === "spawned-1")!;
  expect(spawned.position.x).toBeGreaterThan(4500);
  expect(spawned.position.y).toBeLessThan(-60);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByTestId("dev-sheet-toggle").click();
  const destination = { x: teleported.position.x - .8, y: teleported.position.y, z: teleported.position.z + .3 };
  const projected = await page.evaluate(position => window.__worldDiagnostics!.projectPosition(position), destination);
  await page.mouse.click(projected.x, projected.y);
  await expect.poll(async () => {
    const local = (await snapshot(page)).entities.find(entity => entity.id === "local-player")!;
    return Math.hypot(local.authoritativePosition.x - teleported.position.x, local.authoritativePosition.z - teleported.position.z);
  }, { timeout: 25_000 }).toBeGreaterThan(.3);
  await expect.poll(async () => (await snapshot(page)).entities.find(entity => entity.id === "local-player")!.animation, { timeout: 25_000 }).toBe("idle");
  await expect.poll(async () => (await snapshot(page)).environment.world!.activeLoads, { timeout: 60_000 }).toBe(0);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "island-characters.png") });
  const frames = [];
  for (let frame = 0; frame < 8; frame++) {
    await page.mouse.move(900, 380);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(970, 390, { steps: 5 });
    await page.mouse.up({ button: "right" });
    await page.screenshot({ path: resolve(evidence, `orbit-${frame}.png`) });
    frames.push(await snapshot(page));
  }
  const final = frames.at(-1)!;
  expect(Math.abs(final.camera!.alpha - initial.camera!.alpha)).toBeGreaterThan(.1);
  expect(frames.every(frame => (frame.environment.world as ImportedWorldInspection).errors.length === 0)).toBe(true);
  expect(new Set(frames.map(frame => frame.environment.world!.visiblePlacements)).size).toBe(1);
  expect(new Set(frames.map(frame => frame.environment.world!.visibilityTransitions)).size).toBe(1);
  expect(final.environment.world!.grass?.errors).toBe(0);
  const gpu = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
    return { engine: canvas.dataset.engine, context: Boolean(canvas.getContext("webgpu")), adapter: window.__worldWebGPUInfo };
  });
  expect(gpu.engine).toBe("WebGPU");
  expect(gpu.context).toBe(true);
  expect(gpu.adapter).toBeDefined();
  await writeFile(resolve(evidence, process.env.WORLD_HARDWARE_TEST === "1" ? "world-hardware-report.json" : "world-browser-report.json"), JSON.stringify({ initial, frames, errors, gpu }, null, 2));
  expect(errors).toEqual([]);
});

test("the imported island supports compact touch controls", async ({ browser }) => {
  test.skip(!staged, "Run pnpm world:stage to verify the actual imported island.");
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto("/");
    await expect(page.getByTestId("entity-count")).toHaveText("6", { timeout: 120_000 });
    await expect.poll(async () => (await snapshot(page)).entities.filter(entity => !entity.isFallback).length, { timeout: 60_000 }).toBe(3);
    const before = (await snapshot(page)).entities.find(entity => entity.id === "local-player")!;
    await page.getByRole("button", { name: "Teleport", exact: true }).tap();
    await expect.poll(async () => (await snapshot(page)).entities.find(entity => entity.id === "local-player")!.position.x).not.toBe(before.position.x);
    await page.getByRole("button", { name: "Select Elyra", exact: true }).tap();
    await expect(page.getByTestId("target-name")).toHaveText("Elyra");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, "island-mobile.png") });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("an unstaged world retains the courtyard and a corrupt receipt fails visibly", async ({ page }) => {
  await page.route("**/assets/world/manifest.json", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html></html>" }));
  await page.goto("/");
  await expect(page.getByTestId("entity-count")).toHaveText("6");
  expect((await snapshot(page)).environment.mode).toBe("courtyard");
  await page.unroute("**/assets/world/manifest.json");
  await page.route("**/assets/world/manifest.json", route => route.fulfill({ contentType: "application/json", body: '{"schemaVersion":0}' }));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("does not match the audited");
  expect(await page.evaluate(() => Boolean(window.__worldDiagnostics))).toBe(false);
});
