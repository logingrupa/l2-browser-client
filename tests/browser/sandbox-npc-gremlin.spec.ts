import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, landscapePhone } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";
import type { NativeNpcHarnessEntry } from "./harness/nativeNpcHarness";

const laneName = "actors";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const evidenceDirectory = resolve("artifacts/npc-evidence");
const gremlinKey = "npc:20001";
const rabbitKey = "npc:20002";
const modelCatalogIdPattern = /^npc-model:[a-f0-9]{64}$/;
const harnessLoadTimeout = 90_000;
const sandboxGremlinEntityId = "npc-20001-1";
const worldReadyTimeout = 240_000;
const portraitPhone = { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors");
test.skip(!existsSync(laneCatalogPath), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --npc 20001 first");

async function openHarness(page: Page, npcIds: readonly number[]): Promise<readonly NativeNpcHarnessEntry[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/tests/browser/harness/native-npc.html?${npcIds.map(npcId => `npc=${npcId}`).join("&")}`);
  await expect(page.locator("#native-npc-harness")).toHaveAttribute("data-status", /^(ready|failed)$/, { timeout: harnessLoadTimeout });
  expect(await page.locator("#native-npc-harness").getAttribute("data-failure")).toBeNull();
  expect(pageErrors).toEqual([]);
  return page.evaluate(() => window.__nativeNpcHarness!.snapshot());
}

function entryFor(entries: readonly NativeNpcHarnessEntry[], key: string): NativeNpcHarnessEntry {
  const entry = entries.find(candidate => candidate.key === key);
  if (!entry) throw new Error(`${key} is not on the harness page`);
  return entry;
}

test("spawns npc:20001 by id from the actors lane store with meshes, a skeleton and native clips", async ({ page, baseURL }) => {
  test.setTimeout(harnessLoadTimeout * 2);
  const gremlin = entryFor(await openHarness(page, [20001]), gremlinKey);
  expect(gremlin.reason).toBeNull();
  expect(gremlin.status).toBe("converted");
  expect(gremlin.modelCatalogId).toMatch(modelCatalogIdPattern);
  expect(gremlin.preview?.meshes).toBeGreaterThan(0);
  expect(gremlin.preview?.skeletons).toBeGreaterThanOrEqual(1);
  expect(gremlin.clips.length).toBeGreaterThan(0);
  for (const clip of gremlin.clips) {
    expect(clip.nativeTiming).toBe(true);
    expect(clip.durationSeconds).toBeGreaterThan(0);
  }
  await page.evaluate(key => window.__nativeNpcHarness!.play(key, 0), gremlinKey);
  await expect.poll(() => page.evaluate(key => window.__nativeNpcHarness!.snapshot().find(entry => entry.key === key)?.preview?.nativePlayback?.durationSeconds ?? null, gremlinKey))
    .toBe(gremlin.clips[0]!.durationSeconds);
  if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
  writeLoadCheckRecord(laneName, await servedLaneCatalogSha256(baseURL), {
    key: gremlinKey, status: "pass", reason: null, atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: 2,
  });
});

async function openGremlinAndRabbit(browser: Browser, contextOptions: BrowserContextOptions, check: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    const entries = await openHarness(page, [20001, 20002]);
    expect(entryFor(entries, gremlinKey).status).toBe("converted");
    const rabbit = entryFor(entries, rabbitKey);
    expect(rabbit.status).not.toBe("converted");
    expect(rabbit.reason).not.toBeNull();
    const marker = page.locator(`[data-npc-key="${rabbitKey}"]`);
    await expect(marker).toBeVisible();
    await expect(marker).toHaveText(`${rabbitKey} ${rabbit.status}: ${rabbit.reason}`);
    await expect(page.locator(`[data-npc-preview="${rabbitKey}"]`)).toHaveCount(0);
    await check(page);
  } finally {
    await context.close();
  }
}

for (const [label, contextOptions, screenshotName] of [
  ["1440 x 900", { viewport: desktopViewport }, "npc-20001-20002-1440x900.png"],
  ["932 x 430 on a landscape touch phone", landscapePhone, "npc-20001-20002-932x430.png"],
] as const) {
  test(`shows npc:20002 as a labelled marker without a model next to npc:20001 at ${label}`, async ({ browser }) => {
    test.setTimeout(harnessLoadTimeout * 2);
    await openGremlinAndRabbit(browser, contextOptions, async page => {
      mkdirSync(evidenceDirectory, { recursive: true });
      await page.screenshot({ path: resolve(evidenceDirectory, screenshotName) });
    });
  });
}

test("has no horizontal scroll at 430 x 932 portrait", async ({ browser }) => {
  test.setTimeout(harnessLoadTimeout * 2);
  await openGremlinAndRabbit(browser, portraitPhone, async page => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

const sandboxEntities = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  return window.__nativeSlice.snapshot().entities;
});

async function playFirstGremlinClipFromPicker(page: Page): Promise<string> {
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-sandbox").click();
  await page.getByTestId("sandbox-spawn-npc-npcId").fill("20001");
  await page.getByTestId("sandbox-spawn-npc-submit").click();
  await expect(page.getByTestId("sandbox-spawn-note")).toHaveText(`${gremlinKey} converted`);
  await expect.poll(async () => (await sandboxEntities(page)).find(entity => entity.id === sandboxGremlinEntityId)?.modelId ?? null,
    { timeout: harnessLoadTimeout }).not.toBeNull();
  await page.evaluate(() => window.__nativeSlice!.dispatch({ type: "set-paused", isPaused: true }));
  await page.getByTestId("sandbox-clips-reread").click();
  await page.getByTestId("sandbox-clips-actor").locator("select").selectOption(sandboxGremlinEntityId);
  const firstClip = page.getByTestId("sandbox-clips-clip-0");
  const clipName = await firstClip.textContent();
  if (!clipName) throw new Error(`The clip picker lists no clip for ${sandboxGremlinEntityId}.`);
  await firstClip.click();
  await expect.poll(async () => {
    const gremlin = (await sandboxEntities(page)).find(entity => entity.id === sandboxGremlinEntityId);
    return { activeClip: gremlin?.playback?.activeClip ?? null, clipDiagnostic: gremlin?.clipDiagnostic ?? null };
  }).toEqual({ activeClip: clipName, clipDiagnostic: null });
  return clipName;
}

function collectPageErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  return pageErrors;
}

test.describe("clip picker on the native route at 1440 x 900", () => {
  test.use({ viewport: desktopViewport });

  test("plays the first listed npc:20001 clip from the Clips picker and reads it back as previewing", async ({ page }) => {
    test.setTimeout(worldReadyTimeout + harnessLoadTimeout * 2);
    const pageErrors = collectPageErrors(page);
    const clipName = await playFirstGremlinClipFromPicker(page);
    await page.mouse.move(0, 0);
    await page.getByTestId("sandbox-clips-clip-0").hover();
    await expect(page.getByTestId("dev-hovercard").locator('[data-variable="clips.previewing"] .dev-variable-value')).toHaveText(clipName);
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, "sandbox-clip-picker-npc-20001-1440x900.png") });
    expect(pageErrors).toEqual([]);
  });
});

test.describe("clip picker on the native route at 932 x 430 on a landscape touch phone", () => {
  test.use(landscapePhone);

  test("plays the first listed npc:20001 clip from the Clips picker", async ({ page }) => {
    test.setTimeout(worldReadyTimeout + harnessLoadTimeout * 2);
    const pageErrors = collectPageErrors(page);
    await playFirstGremlinClipFromPicker(page);
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, "sandbox-clip-picker-npc-20001-932x430.png") });
    expect(pageErrors).toEqual([]);
  });
});

test.describe("clip picker on the native route at 430 x 932 portrait", () => {
  test.use(portraitPhone);

  test("has no horizontal scroll with the Clips section open", async ({ page }) => {
    test.setTimeout(worldReadyTimeout + harnessLoadTimeout * 2);
    await playFirstGremlinClipFromPicker(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
