import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AssetInspectionSnapshot } from "./assetInspection";
import type { WorldDiagnostics } from "../../src/runtime/createWorldRuntime";

const variants = ["MFighter", "FFighter", "MMagic", "FMagic"];
const hasLocalAssets = variants.every(variant => existsSync(resolve(`public/assets/characters/${variant}.glb`)));
const evidenceDirectory = resolve("artifacts/asset-integration");
type WorldSnapshot = ReturnType<WorldDiagnostics["snapshot"]>;

async function readInspection(page: Page): Promise<AssetInspectionSnapshot> {
  return page.evaluate(() => {
    if (!window.__assetInspection) throw new Error("Asset inspection diagnostics are missing.");
    return window.__assetInspection.snapshot();
  });
}

async function readWorld(page: Page): Promise<WorldSnapshot> {
  return page.evaluate(() => {
    if (!window.__worldDiagnostics) throw new Error("World diagnostics are missing.");
    return window.__worldDiagnostics.snapshot();
  });
}

async function saveEvidence(name: string, value: unknown): Promise<void> {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(resolve(evidenceDirectory, name), JSON.stringify(value, null, 2));
}

async function loadRealWorld(page: Page) {
  await page.goto("/?world=courtyard");
  await expect.poll(() => page.evaluate(() => Boolean(window.__worldDiagnostics)), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await readWorld(page)).entities.filter(entity => !entity.isFallback).length, { timeout: 60_000 }).toBe(3);
  const readyMetrics = await resourceMetrics(page);
  await expect.poll(async () => Number(await page.getByTestId("fps").textContent())).toBeGreaterThan(0);
  return readyMetrics;
}

async function openControls(page: Page): Promise<void> {
  if (!(await page.getByRole("button", { name: "Pause", exact: true }).isVisible())) await page.getByTestId("dev-sheet-toggle").click();
}

test.describe("local converted character assets", () => {
  test.skip(!hasLocalAssets, "Local converted binaries are intentionally untracked; run pnpm assets:stage before this suite.");
  const errors = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const messages: string[] = [];
    errors.set(page, messages);
    page.on("pageerror", error => messages.push(error.message));
    page.on("console", message => { if (message.type() === "error") messages.push(message.text()); });
    // Vite's hundreds of module requests otherwise fill Chromium's 250-entry default.
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    await mkdir(evidenceDirectory, { recursive: true });
  });

  test.afterEach(async ({ page }) => {
    expect(errors.get(page), "No uncaught exceptions or browser console errors").toEqual([]);
  });

  test("measures targeted grounding repair against unchanged source hashes", async ({ page }) => {
    test.skip(process.env.ASSET_MEASURE_REPAIR !== "1", "Opt-in offline repair measurement; ordinary verification does not generate repair instructions.");
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/tests/browser/assetInspection.html");
    await expect(page.getByRole("status")).toHaveText("Four textured characters ready.", { timeout: 60_000 });
    await page.getByRole("combobox", { name: "Character view" }).selectOption("FMagic");
    await page.getByRole("combobox", { name: "Native clip" }).selectOption("run_Hand");
    await page.getByRole("spinbutton", { name: "Animation frame" }).fill("21.25");
    await page.getByRole("button", { name: "Show frame", exact: true }).click();
    const defect = await readInspection(page);
    await saveEvidence("grounding-defect-FMagic-run-frame21.25.json", defect);
    await page.screenshot({ path: resolve(evidenceDirectory, "grounding-defect-FMagic-run-frame21.25.png") });
    expect(defect.pausedPose?.[0]?.bounds.min[1]).toBeLessThan(-0.035);
    await page.getByRole("combobox", { name: "Character view" }).selectOption("all");
    await page.getByRole("button", { name: "Measure grounding repair", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Targeted grounding measurements complete.", { timeout: 240_000 });
    const measured = await readInspection(page);
    const directory = resolve(evidenceDirectory, "repair/conversion");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "grounding-corrections.json"), JSON.stringify(measured.groundingCorrections, null, 2));
    expect(measured.groundingCorrections?.variants).toHaveLength(4);
    expect(measured.groundingCorrections?.variants.flatMap(variant => variant.clips)).toHaveLength(7);
  });

  test("captures native run and attack skinning poses for all four preserved rigs", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/tests/browser/assetInspection.html");
    await expect(page.getByRole("status")).toHaveText("Four textured characters ready.", { timeout: 60_000 });
    for (const [clip, frame, filename] of [["run_Hand", "15", "skinning-run"], ["Atk01_Hand", "30", "skinning-attack"]]) {
      if (!clip || !frame || !filename) throw new Error("Incomplete screenshot pose.");
      await page.getByRole("combobox", { name: "Native clip" }).selectOption(clip);
      await page.getByRole("spinbutton", { name: "Animation frame" }).fill(frame);
      await page.getByRole("button", { name: "Show frame", exact: true }).click();
      const state = await readInspection(page);
      expect(state.pausedPose).toHaveLength(4);
      expect(state.characters.every(character => character.meshCount === 7 && character.activeClips.some(active => active.name === clip && active.frame > 0))).toBe(true);
      await page.screenshot({ path: resolve(evidenceDirectory, `${filename}.png`) });
      await saveEvidence(`${filename}.json`, state);
    }
    await page.getByRole("combobox", { name: "Character view" }).selectOption("FMagic");
    await page.getByRole("combobox", { name: "Native clip" }).selectOption("run_Hand");
    await page.getByRole("spinbutton", { name: "Animation frame" }).fill("21.25");
    await page.getByRole("button", { name: "Show frame", exact: true }).click();
    const repairedPose = await readInspection(page);
    await page.screenshot({ path: resolve(evidenceDirectory, "grounding-repaired-FMagic-run-frame21.25.png") });
    await saveEvidence("grounding-repaired-FMagic-run-frame21.25.json", repairedPose);
    expect(repairedPose.pausedPose?.[0]?.bounds.min[1]).toBeGreaterThanOrEqual(-0.0021);
    // This unequipped polearm family remains outside the three mapped demo states.
    // Preserve its measured defect as evidence instead of claiming every clip is grounded.
    await page.getByRole("combobox", { name: "Character view" }).selectOption("MFighter");
    await page.getByRole("combobox", { name: "Native clip" }).selectOption("spatk03_Pole");
    await page.getByRole("spinbutton", { name: "Animation frame" }).fill("66.2499976");
    await page.getByRole("button", { name: "Show frame", exact: true }).click();
    const remainingPose = await readInspection(page);
    await page.screenshot({ path: resolve(evidenceDirectory, "remaining-defect-MFighter-spatk03_Pole-frame66.25.png") });
    await saveEvidence("remaining-defect-MFighter-spatk03_Pole-frame66.25.json", remainingPose);
    expect(Number.isFinite(remainingPose.pausedPose?.[0]?.bounds.min[1])).toBe(true);
  });

  test("renders all native parts and textures and verifies skinning between repaired keys at 384 Hz", async ({ page }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/tests/browser/assetInspection.html");
    await expect(page.getByRole("status")).toHaveText("Four textured characters ready.", { timeout: 60_000 });
    const ready = await readInspection(page);
    expect(ready.babylonVersion).toBe("9.27.1");
    expect(ready.characters.map(character => character.variant)).toEqual(variants);
    expect(ready.characters.every(character => character.meshCount === 7 && character.skeletonCount === 1)).toBe(true);
    await page.screenshot({ path: resolve(evidenceDirectory, "first-textured-render.png") });
    await page.getByRole("button", { name: "Inspect skinning", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Skinning inspection complete: all four variants sampled.", { timeout: 300_000 });
    const inspected = await readInspection(page);
    await saveEvidence("destination-skinning-audit.json", inspected);
    expect(inspected.audit).toHaveLength(4);
    for (const variant of inspected.audit ?? []) {
      expect(variant.assemblyScale).toEqual([1, 1, 1]);
      expect(variant.assemblyOrigin).toEqual([0, 0, 0]);
      expect(variant.bind.finite).toBe(true);
      expect(variant.invalidTargets).toEqual([]);
      expect(variant.geometry).toHaveLength(7);
      expect(variant.skeletons).toHaveLength(1);
      expect(variant.skeletons[0]?.bones.length).toBeGreaterThan(90);
      for (const part of variant.geometry) {
        expect(part.finiteAttributes).toBe(true);
        expect(part.normalCount).toBe(part.vertices);
        expect(part.textureCoordinateCount).toBe(part.vertices);
        expect(part.weightedVertices).toBe(part.vertices);
        expect(part.worstWeightSumError).toBeLessThan(0.00001);
        expect(part.textures.length).toBeGreaterThan(0);
        expect(part.textures.every(texture => texture.ready && texture.size.width > 0 && texture.size.height > 0)).toBe(true);
      }
      expect(variant.clips.length).toBeGreaterThan(100);
      expect(variant.clips.every(clip => clip.finite && clip.maximumHeight < 3 && clip.maximumWidth < 4)).toBe(true);
      for (const name of ["wait_Hand", "run_Hand", "Atk01_Hand"]) {
        const clip = variant.clips.find(candidate => candidate.name === name);
        expect(clip).toBeDefined();
        expect(clip?.samples).toBeGreaterThan(15);
        expect(clip?.maximumDeformation).toBeGreaterThan(0.003);
        expect(clip?.rootHorizontalDisplacement).toBeLessThan(0.01);
        expect(clip?.sampleRate).toBe(name === "run_Hand" || (name === "Atk01_Hand" && variant.variant !== "MMagic") ? 384 : 48);
        // The original correction tolerance is 2 mm; allow only 0.1 mm numerical margin.
        expect(clip?.floorMinimum).toBeGreaterThanOrEqual(-0.0021);
        expect(Math.abs((clip?.floorMinimum ?? Infinity) - (clip?.refreshedFloorMinimum ?? 0))).toBeLessThan(0.000001);
      }
    }
  });

  test("isolates identical rigs and animation targets and disposes every resource of the extra instance", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/tests/browser/assetInspection.html");
    await expect(page.getByRole("status")).toHaveText("Four textured characters ready.", { timeout: 60_000 });
    await page.getByRole("button", { name: "Check independent instances", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Independent instance and disposal inspection complete.", { timeout: 30_000 });
    const inspected = await readInspection(page);
    await saveEvidence("destination-instance-audit.json", inspected);
    const independence = inspected.independence;
    expect(independence).toBeDefined();
    expect(independence?.sharedSkeleton).toBe(false);
    expect(independence?.sharedAnimationTarget).toBe(false);
    expect(independence?.originalPoseChange).toBeLessThan(0.000001);
    expect(independence?.independentPoseDifference).toBeGreaterThan(0.1);
    expect(independence?.afterDisposeCounts).toEqual(independence?.beforeCounts);
  });

  test("integrates three real characters with native one-shots, retrigger, independent state, targeting and disposal", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const readyMetrics = await loadRealWorld(page);
    await openControls(page);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const initial = await readWorld(page);
    expect(initial.entities).toHaveLength(6);
    expect(initial.entities.filter(entity => !entity.isFallback).map(entity => entity.modelId)).toEqual(["FFighter", "MFighter", "MMagic"]);
    for (const entity of initial.entities.filter(candidate => !candidate.isFallback)) {
      expect(entity.parts).toHaveLength(7);
      expect(entity.skeletons).toHaveLength(1);
      expect(entity.bounds.maximum[1]).toBeGreaterThan(1.5);
      expect(entity.bounds.maximum[1]).toBeLessThan(2.1);
      expect(entity.bounds.labelHeight).toBeGreaterThan(entity.bounds.maximum[1] ?? 0);
    }
    const local = async () => (await readWorld(page)).entities.find(entity => entity.id === "local-player");
    const remoteClip = initial.entities.find(entity => entity.id === "remote-1")?.playback?.activeClip;
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect.poll(async () => (await local())?.playback?.activeClip).toBe("run_Hand");
    await page.getByRole("button", { name: "Attack", exact: true }).click();
    await expect.poll(async () => (await local())?.playback?.activeClip).toBe("Atk01_Hand");
    expect((await local())?.playback?.looping).toBe(false);
    await expect.poll(async () => (await local())?.playback?.activeClip, { timeout: 12_000 }).toBe("wait_Hand");
    expect((await local())?.animation).toBe("attack");
    const firstSequence = (await local())?.animationSequence ?? 0;
    await page.getByRole("button", { name: "Attack", exact: true }).click();
    await expect.poll(async () => (await local())?.playback?.activeClip).toBe("Atk01_Hand");
    expect((await local())?.animationSequence).toBe(firstSequence + 1);
    expect((await readWorld(page)).entities.find(entity => entity.id === "remote-1")?.playback?.activeClip).toBe(remoteClip);
    await page.getByRole("button", { name: "Idle", exact: true }).click();
    await page.getByRole("button", { name: "Select Elyra", exact: true }).click();
    await page.getByTestId("dev-sheet-toggle").click();
    await page.screenshot({ path: resolve(evidenceDirectory, "integrated-desktop.png") });
    await saveEvidence("integrated-desktop.json", { world: await readWorld(page), browserErrors: errors.get(page), metrics: readyMetrics });

    const beforeRemoval = await readWorld(page);
    const remote = beforeRemoval.entities.find(entity => entity.id === "remote-1");
    if (!remote) throw new Error("Remote player is missing.");
    await page.mouse.click(remote.screenPosition.x, remote.screenPosition.y);
    await expect(page.getByTestId("target-name")).toHaveText("Orin");
    await openControls(page);
    await page.getByRole("button", { name: "Despawn target", exact: true }).click();
    await expect(page.getByTestId("entity-count")).toHaveText("5");
    await expect(page.getByTestId("target-name")).toHaveText("No target");
    const afterRemoval = await readWorld(page);
    expect(afterRemoval.entities.some(entity => entity.id === "remote-1")).toBe(false);
    expect(afterRemoval.sceneMeshCount).toBe(beforeRemoval.sceneMeshCount - 8);
    expect(afterRemoval.entities.find(entity => entity.id === "local-player")?.isFallback).toBe(false);
  });

  test.describe("mobile local model cost and usability", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("loads native models, retains usable HUD and records cold resources and frame timing", async ({ page }) => {
      test.setTimeout(90_000);
      const readyMetrics = await loadRealWorld(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const name of ["Attack", "Run", "Idle", "Spawn", "Teleport"]) {
        const button = page.getByRole("button", { name, exact: true });
        await expect(button).toBeVisible();
        const bounds = await button.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole("button", { name: "Select Elyra", exact: true }).tap();
      await page.getByRole("button", { name: "Run", exact: true }).tap();
      await expect.poll(async () => (await readWorld(page)).entities.find(entity => entity.id === "local-player")?.playback?.activeClip).toBe("run_Hand");
      const frameTiming = await page.evaluate(async () => {
        const intervals: number[] = [];
        let previous = performance.now();
        for (let sample = 0; sample < 60; sample += 1) {
          const current = await new Promise<number>(resolveFrame => requestAnimationFrame(resolveFrame));
          intervals.push(current - previous);
          previous = current;
        }
        const ordered = [...intervals].sort((first, second) => first - second);
        return { samples: intervals.length, medianMilliseconds: ordered[30], p95Milliseconds: ordered[57], intervals };
      });
      await page.getByRole("button", { name: "Idle", exact: true }).tap();
      await page.screenshot({ path: resolve(evidenceDirectory, "integrated-mobile.png") });
      expect(readyMetrics.resources).toHaveLength(3);
      expect(readyMetrics.resources.reduce((sum, resource) => sum + resource.decodedBytes, 0)).toBeGreaterThan(45_000_000);
      await saveEvidence("integrated-mobile.json", { world: await readWorld(page), browserErrors: errors.get(page), metrics: readyMetrics, frameTiming, viewport: { width: 390, height: 844 }, rendering: "Playwright Chromium WebGPU; touch emulation, not a physical device" });
    });
  });
});

async function resourceMetrics(page: Page) {
  return page.evaluate(() => ({
    elapsedMilliseconds: performance.now(),
    resources: performance.getEntriesByType("resource").filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming && entry.name.endsWith(".glb")).map(entry => ({ url: entry.name, durationMilliseconds: entry.duration, transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize })),
  }));
}
